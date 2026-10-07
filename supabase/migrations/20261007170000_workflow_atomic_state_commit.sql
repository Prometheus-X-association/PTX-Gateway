-- Commit the completed step, durable checkpoint and optional encrypted state
-- patch under one lease/version check. A stale worker cannot partially commit.
DROP FUNCTION public.update_workflow_run_state(uuid,uuid,uuid,bigint,text);

CREATE TABLE public.workflow_run_state_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL,
  run_id uuid NOT NULL,
  state_version bigint NOT NULL,
  node_id text NOT NULL,
  changed_keys text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (run_id, organization_id) REFERENCES public.workflow_runs(id, organization_id) ON DELETE CASCADE
);
ALTER TABLE public.workflow_run_state_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workflow_run_state_events FROM anon, authenticated;
GRANT ALL ON public.workflow_run_state_events TO service_role;
CREATE INDEX workflow_run_state_events_run_version ON public.workflow_run_state_events(organization_id, run_id, state_version);

CREATE FUNCTION public.commit_workflow_run_node(
  p_run_id uuid,
  p_organization_id uuid,
  p_lease_token uuid,
  p_expected_state_version bigint,
  p_checkpoint jsonb,
  p_step_id uuid,
  p_step_status text,
  p_step_output jsonb,
  p_step_error text,
  p_step_duration_ms integer,
  p_step_attempt_count integer,
  p_selected_routes jsonb,
  p_changed_keys text[],
  p_state_ciphertext text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE next_version bigint;
BEGIN
  IF p_step_status NOT IN ('succeeded','failed','waiting','cancelled','timed_out') THEN
    RAISE EXCEPTION 'Invalid workflow step status.' USING ERRCODE = '22023';
  END IF;
  IF p_state_ciphertext IS NOT NULL AND (length(p_state_ciphertext) < 10 OR length(p_state_ciphertext) > 30000000) THEN
    RAISE EXCEPTION 'Invalid encrypted workflow state.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.workflow_runs
  SET checkpoint = p_checkpoint,
      run_state_ciphertext = coalesce(p_state_ciphertext, run_state_ciphertext),
      state_version = state_version + CASE WHEN p_state_ciphertext IS NULL THEN 0 ELSE 1 END,
      last_node_id = (SELECT node_id FROM public.workflow_run_steps WHERE id=p_step_id AND run_id=p_run_id),
      failed_node_id = CASE WHEN p_step_status='failed' THEN (SELECT node_id FROM public.workflow_run_steps WHERE id=p_step_id AND run_id=p_run_id) ELSE failed_node_id END,
      current_node_id = NULL,
      current_operation_id = NULL,
      current_side_effect_class = NULL,
      updated_at = clock_timestamp()
  WHERE id = p_run_id
    AND organization_id = p_organization_id
    AND lease_token = p_lease_token
    AND status = 'running'
    AND lease_expires_at > clock_timestamp()
    AND state_version = p_expected_state_version
  RETURNING state_version INTO next_version;
  IF next_version IS NULL THEN
    RAISE EXCEPTION 'Workflow state version or lease changed.' USING ERRCODE = '40001';
  END IF;

  UPDATE public.workflow_run_steps
  SET status=p_step_status, output_summary=p_step_output, error=p_step_error,
      duration_ms=p_step_duration_ms, attempt_count=p_step_attempt_count,
      selected_routes=p_selected_routes, finished_at=clock_timestamp()
  WHERE id=p_step_id AND run_id=p_run_id AND organization_id=p_organization_id AND status='running';
  IF NOT FOUND THEN RAISE EXCEPTION 'Workflow step changed before commit.' USING ERRCODE='40001'; END IF;
  IF p_state_ciphertext IS NOT NULL AND cardinality(coalesce(p_changed_keys, ARRAY[]::text[])) > 0 THEN
    INSERT INTO public.workflow_run_state_events(organization_id,run_id,state_version,node_id,changed_keys)
    SELECT p_organization_id,p_run_id,next_version,node_id,p_changed_keys FROM public.workflow_run_steps WHERE id=p_step_id;
  END IF;
  RETURN next_version;
END $$;

REVOKE ALL ON FUNCTION public.commit_workflow_run_node(uuid,uuid,uuid,bigint,jsonb,uuid,text,jsonb,text,integer,integer,jsonb,text[],text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_workflow_run_node(uuid,uuid,uuid,bigint,jsonb,uuid,text,jsonb,text,integer,integer,jsonb,text[],text) TO service_role;
