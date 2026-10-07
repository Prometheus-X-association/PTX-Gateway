-- Final output and terminal status must cross the same lease/version boundary as
-- the output-node checkpoint. A worker crash can no longer leave a completed
-- output checkpoint to be recovered as an incomplete run.
CREATE TABLE public.workflow_parallel_branches (
  organization_id uuid NOT NULL,
  run_id uuid NOT NULL,
  activation_id text NOT NULL CHECK (length(activation_id) BETWEEN 1 AND 500),
  branch_id text NOT NULL CHECK (length(branch_id) BETWEEN 1 AND 200),
  node_ids text[] NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('running','succeeded','failed')),
  result_ciphertext text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (run_id, activation_id, branch_id),
  FOREIGN KEY (run_id, organization_id) REFERENCES public.workflow_runs(id, organization_id) ON DELETE CASCADE
);
ALTER TABLE public.workflow_parallel_branches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workflow_parallel_branches FROM anon, authenticated;
GRANT ALL ON public.workflow_parallel_branches TO service_role;
CREATE INDEX workflow_parallel_branches_run ON public.workflow_parallel_branches(organization_id, run_id, activation_id);

CREATE FUNCTION public.start_workflow_parallel_branch(
  p_run_id uuid, p_organization_id uuid, p_lease_token uuid,
  p_activation_id text, p_branch_id text, p_node_ids text[]
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.workflow_runs WHERE id=p_run_id AND organization_id=p_organization_id
    AND lease_token=p_lease_token AND status='running' AND lease_expires_at>clock_timestamp()) THEN
    RAISE EXCEPTION 'Workflow lease changed before parallel branch start.' USING ERRCODE='40001';
  END IF;
  INSERT INTO public.workflow_parallel_branches(organization_id,run_id,activation_id,branch_id,node_ids,status,started_at,updated_at)
  VALUES(p_organization_id,p_run_id,p_activation_id,p_branch_id,p_node_ids,'running',clock_timestamp(),clock_timestamp())
  ON CONFLICT(run_id,activation_id,branch_id) DO UPDATE SET node_ids=excluded.node_ids,status='running',result_ciphertext=NULL,
    started_at=clock_timestamp(),finished_at=NULL,updated_at=clock_timestamp();
END $$;

CREATE FUNCTION public.complete_workflow_parallel_branch(
  p_run_id uuid, p_organization_id uuid, p_lease_token uuid,
  p_activation_id text, p_branch_id text, p_status text,
  p_result_ciphertext text, p_node_ids text[]
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF p_status NOT IN ('succeeded','failed') OR length(p_result_ciphertext)<10 OR length(p_result_ciphertext)>30000000 THEN
    RAISE EXCEPTION 'Invalid parallel branch result.' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workflow_runs WHERE id=p_run_id AND organization_id=p_organization_id
    AND lease_token=p_lease_token AND status='running' AND lease_expires_at>clock_timestamp()) THEN
    RAISE EXCEPTION 'Workflow lease changed before parallel branch completion.' USING ERRCODE='40001';
  END IF;
  UPDATE public.workflow_parallel_branches SET status=p_status,result_ciphertext=p_result_ciphertext,node_ids=p_node_ids,
    finished_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE organization_id=p_organization_id AND run_id=p_run_id AND activation_id=p_activation_id AND branch_id=p_branch_id AND status='running';
  IF NOT FOUND THEN RAISE EXCEPTION 'Parallel branch activation changed before completion.' USING ERRCODE='40001'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.start_workflow_parallel_branch(uuid,uuid,uuid,text,text,text[]), public.complete_workflow_parallel_branch(uuid,uuid,uuid,text,text,text,text,text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_workflow_parallel_branch(uuid,uuid,uuid,text,text,text[]), public.complete_workflow_parallel_branch(uuid,uuid,uuid,text,text,text,text,text[]) TO service_role;

DROP FUNCTION public.commit_workflow_run_node(uuid,uuid,uuid,bigint,jsonb,uuid,text,jsonb,text,integer,integer,jsonb,text[],jsonb,uuid[],text);
CREATE FUNCTION public.commit_workflow_run_node(
  p_run_id uuid, p_organization_id uuid, p_lease_token uuid,
  p_expected_state_version bigint, p_checkpoint jsonb, p_step_id uuid,
  p_step_status text, p_step_output jsonb, p_step_error text,
  p_step_duration_ms integer, p_step_attempt_count integer,
  p_selected_routes jsonb, p_changed_keys text[], p_pending_signals jsonb,
  p_consumed_signal_ids uuid[], p_state_ciphertext text DEFAULT NULL,
  p_terminal_status text DEFAULT NULL, p_final_output jsonb DEFAULT NULL,
  p_render_as text DEFAULT NULL, p_stop_reason text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE next_version bigint;
BEGIN
  IF p_step_status NOT IN ('succeeded','failed','waiting','cancelled','timed_out') THEN RAISE EXCEPTION 'Invalid workflow step status.' USING ERRCODE='22023'; END IF;
  IF p_terminal_status IS NOT NULL AND p_terminal_status NOT IN ('succeeded','failed','cancelled','timed_out','incomplete') THEN RAISE EXCEPTION 'Invalid terminal workflow status.' USING ERRCODE='22023'; END IF;
  IF p_terminal_status IS NOT NULL AND p_step_status <> 'succeeded' THEN RAISE EXCEPTION 'Only a successful step can atomically finish a workflow.' USING ERRCODE='22023'; END IF;
  IF p_state_ciphertext IS NOT NULL AND (length(p_state_ciphertext)<10 OR length(p_state_ciphertext)>30000000) THEN RAISE EXCEPTION 'Invalid encrypted workflow state.' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_pending_signals) <> 'array' OR jsonb_array_length(p_pending_signals)>100 THEN RAISE EXCEPTION 'Invalid pending workflow signals.' USING ERRCODE='22023'; END IF;

  UPDATE public.workflow_runs SET checkpoint=p_checkpoint,
    run_state_ciphertext=coalesce(p_state_ciphertext,run_state_ciphertext),
    state_version=state_version+CASE WHEN p_state_ciphertext IS NULL THEN 0 ELSE 1 END,
    pending_signals=p_pending_signals,
    last_node_id=(SELECT node_id FROM public.workflow_run_steps WHERE id=p_step_id AND run_id=p_run_id),
    failed_node_id=CASE WHEN p_step_status='failed' THEN (SELECT node_id FROM public.workflow_run_steps WHERE id=p_step_id AND run_id=p_run_id) ELSE failed_node_id END,
    current_node_id=NULL,current_operation_id=NULL,current_side_effect_class=NULL,
    status=coalesce(p_terminal_status,status), output=CASE WHEN p_terminal_status IS NULL THEN output ELSE p_final_output END,
    render_as=CASE WHEN p_terminal_status IS NULL THEN render_as ELSE p_render_as END,
    stop_reason=CASE WHEN p_terminal_status IS NULL THEN stop_reason ELSE p_stop_reason END,
    finished_at=CASE WHEN p_terminal_status IS NULL THEN finished_at ELSE clock_timestamp() END,
    lease_token=CASE WHEN p_terminal_status IS NULL THEN lease_token ELSE NULL END,
    lease_expires_at=CASE WHEN p_terminal_status IS NULL THEN lease_expires_at ELSE NULL END,
    updated_at=clock_timestamp()
  WHERE id=p_run_id AND organization_id=p_organization_id AND lease_token=p_lease_token
    AND status='running' AND lease_expires_at>clock_timestamp() AND state_version=p_expected_state_version
  RETURNING state_version INTO next_version;
  IF next_version IS NULL THEN RAISE EXCEPTION 'Workflow state version or lease changed.' USING ERRCODE='40001'; END IF;

  UPDATE public.workflow_run_steps SET status=p_step_status,output_summary=p_step_output,error=p_step_error,
    duration_ms=p_step_duration_ms,attempt_count=p_step_attempt_count,selected_routes=p_selected_routes,finished_at=clock_timestamp()
  WHERE id=p_step_id AND run_id=p_run_id AND organization_id=p_organization_id AND status='running';
  IF NOT FOUND THEN RAISE EXCEPTION 'Workflow step changed before commit.' USING ERRCODE='40001'; END IF;
  IF p_state_ciphertext IS NOT NULL AND cardinality(coalesce(p_changed_keys,ARRAY[]::text[]))>0 THEN
    INSERT INTO public.workflow_run_state_events(organization_id,run_id,state_version,node_id,changed_keys)
    SELECT p_organization_id,p_run_id,next_version,node_id,p_changed_keys FROM public.workflow_run_steps WHERE id=p_step_id;
  END IF;
  UPDATE public.workflow_run_signal_events SET consumed_at=clock_timestamp(),consumed_by_node_id=(SELECT node_id FROM public.workflow_run_steps WHERE id=p_step_id)
  WHERE organization_id=p_organization_id AND run_id=p_run_id AND id=ANY(coalesce(p_consumed_signal_ids,ARRAY[]::uuid[])) AND consumed_at IS NULL;
  RETURN next_version;
END $$;
REVOKE ALL ON FUNCTION public.commit_workflow_run_node(uuid,uuid,uuid,bigint,jsonb,uuid,text,jsonb,text,integer,integer,jsonb,text[],jsonb,uuid[],text,text,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_workflow_run_node(uuid,uuid,uuid,bigint,jsonb,uuid,text,jsonb,text,integer,integer,jsonb,text[],jsonb,uuid[],text,text,jsonb,text,text) TO service_role;
