-- Durable workflow event gates. Signal payloads remain encrypted while queued;
-- the audit table deliberately stores metadata only.
ALTER TABLE public.workflow_runs
  ADD COLUMN event_wait jsonb,
  ADD COLUMN pending_signals jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.workflow_runs DROP CONSTRAINT workflow_runs_status_check;
ALTER TABLE public.workflow_runs ADD CONSTRAINT workflow_runs_status_check CHECK (status IN
  ('queued','running','waiting_for_input','waiting_for_event','manual_review','succeeded','failed','cancelled','timed_out','incomplete'));

CREATE TABLE public.workflow_run_signal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  run_id uuid NOT NULL,
  signal_name text NOT NULL CHECK (signal_name ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,99}$'),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  consumed_at timestamptz,
  consumed_by_node_id text,
  FOREIGN KEY (run_id, organization_id) REFERENCES public.workflow_runs(id, organization_id) ON DELETE CASCADE
);
ALTER TABLE public.workflow_run_signal_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workflow_run_signal_events FROM anon, authenticated;
GRANT ALL ON public.workflow_run_signal_events TO service_role;
CREATE INDEX workflow_run_signal_events_run_time ON public.workflow_run_signal_events(organization_id, run_id, received_at);

CREATE FUNCTION public.signal_workflow_run(
  p_run_id uuid,
  p_organization_id uuid,
  p_signal_name text,
  p_payload_ciphertext text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE signal_id uuid := gen_random_uuid(); received timestamptz := clock_timestamp();
BEGIN
  IF p_signal_name !~ '^[A-Za-z][A-Za-z0-9_.:-]{0,99}$'
     OR length(p_payload_ciphertext) < 10 OR length(p_payload_ciphertext) > 400000 THEN
    RAISE EXCEPTION 'Invalid workflow signal.' USING ERRCODE='22023';
  END IF;
  UPDATE public.workflow_runs
  SET pending_signals = pending_signals || jsonb_build_array(jsonb_build_object(
        'id',signal_id,'name',p_signal_name,'ciphertext',p_payload_ciphertext,'receivedAt',received)),
      status='queued', event_wait=NULL, finished_at=NULL, updated_at=received
  WHERE id=p_run_id AND organization_id=p_organization_id
    AND status='waiting_for_event'
    AND event_wait->>'eventType'='external_signal'
    AND event_wait->>'signalName'=p_signal_name
    AND jsonb_array_length(pending_signals) < 100;
  IF NOT FOUND THEN RAISE EXCEPTION 'Run is not waiting for this signal.' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.workflow_run_signal_events(id,organization_id,run_id,signal_name,received_at)
  VALUES(signal_id,p_organization_id,p_run_id,p_signal_name,received);
  RETURN signal_id;
END $$;
REVOKE ALL ON FUNCTION public.signal_workflow_run(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.signal_workflow_run(uuid,uuid,text,text) TO service_role;

-- Extend the atomic node commit so consuming a signal and advancing the
-- checkpoint cannot be split by a crash or stale worker lease.
DROP FUNCTION public.commit_workflow_run_node(uuid,uuid,uuid,bigint,jsonb,uuid,text,jsonb,text,integer,integer,jsonb,text[],text);
CREATE FUNCTION public.commit_workflow_run_node(
  p_run_id uuid, p_organization_id uuid, p_lease_token uuid,
  p_expected_state_version bigint, p_checkpoint jsonb, p_step_id uuid,
  p_step_status text, p_step_output jsonb, p_step_error text,
  p_step_duration_ms integer, p_step_attempt_count integer,
  p_selected_routes jsonb, p_changed_keys text[], p_pending_signals jsonb,
  p_consumed_signal_ids uuid[], p_state_ciphertext text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE next_version bigint;
BEGIN
  IF p_step_status NOT IN ('succeeded','failed','waiting','cancelled','timed_out') THEN RAISE EXCEPTION 'Invalid workflow step status.' USING ERRCODE='22023'; END IF;
  IF p_state_ciphertext IS NOT NULL AND (length(p_state_ciphertext)<10 OR length(p_state_ciphertext)>30000000) THEN RAISE EXCEPTION 'Invalid encrypted workflow state.' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_pending_signals) <> 'array' OR jsonb_array_length(p_pending_signals)>100 THEN RAISE EXCEPTION 'Invalid pending workflow signals.' USING ERRCODE='22023'; END IF;
  UPDATE public.workflow_runs SET checkpoint=p_checkpoint,
    run_state_ciphertext=coalesce(p_state_ciphertext,run_state_ciphertext),
    state_version=state_version+CASE WHEN p_state_ciphertext IS NULL THEN 0 ELSE 1 END,
    pending_signals=p_pending_signals,
    last_node_id=(SELECT node_id FROM public.workflow_run_steps WHERE id=p_step_id AND run_id=p_run_id),
    failed_node_id=CASE WHEN p_step_status='failed' THEN (SELECT node_id FROM public.workflow_run_steps WHERE id=p_step_id AND run_id=p_run_id) ELSE failed_node_id END,
    current_node_id=NULL,current_operation_id=NULL,current_side_effect_class=NULL,updated_at=clock_timestamp()
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
REVOKE ALL ON FUNCTION public.commit_workflow_run_node(uuid,uuid,uuid,bigint,jsonb,uuid,text,jsonb,text,integer,integer,jsonb,text[],jsonb,uuid[],text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_workflow_run_node(uuid,uuid,uuid,bigint,jsonb,uuid,text,jsonb,text,integer,integer,jsonb,text[],jsonb,uuid[],text) TO service_role;

CREATE OR REPLACE FUNCTION public.workflow_health(p_organization_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object(
    'workers',coalesce((SELECT jsonb_agg(jsonb_build_object('workerId',worker_id,'activeRuns',active_runs,'capacity',capacity,'version',version,'startedAt',started_at,'lastSeenAt',last_seen_at)) FROM public.workflow_worker_heartbeats WHERE last_seen_at>clock_timestamp()-interval '30 seconds'),'[]'::jsonb),
    'queueDepth',(SELECT count(*) FROM public.workflow_runs WHERE organization_id=p_organization_id AND status='queued'),
    'oldestQueuedAt',(SELECT min(created_at) FROM public.workflow_runs WHERE organization_id=p_organization_id AND status='queued'),
    'runningRuns',(SELECT count(*) FROM public.workflow_runs WHERE organization_id=p_organization_id AND status='running'),
    'waitingRuns',(SELECT count(*) FROM public.workflow_runs WHERE organization_id=p_organization_id AND status IN ('waiting_for_input','waiting_for_event')),
    'manualReviewRuns',(SELECT count(*) FROM public.workflow_runs WHERE organization_id=p_organization_id AND status='manual_review'),
    'expiredLeases',(SELECT count(*) FROM public.workflow_runs WHERE organization_id=p_organization_id AND status='running' AND lease_expires_at<clock_timestamp()),
    'notificationBacklog',(SELECT count(*) FROM public.workflow_notifications WHERE organization_id=p_organization_id AND status IN ('pending','delivering')))
$$;

-- Include event waits in admission accounting without changing existing policy defaults.
CREATE OR REPLACE FUNCTION public.enforce_workflow_run_quota() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE policy public.workflow_execution_policies; caller_limit integer; caller_hour_limit integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text,918273));
  SELECT * INTO policy FROM public.workflow_execution_policies WHERE organization_id=NEW.organization_id;
  IF NOT FOUND THEN policy.max_queued_runs:=200; policy.max_outstanding_runs:=1000; policy.max_caller_outstanding_runs:=100; policy.max_starts_per_hour:=1000; END IF;
  caller_limit:=CASE WHEN NEW.caller_id LIKE 'public:%' THEN least(policy.max_caller_outstanding_runs,20) ELSE policy.max_caller_outstanding_runs END;
  caller_hour_limit:=CASE WHEN NEW.caller_id LIKE 'public:%' THEN least(policy.max_starts_per_hour,100) ELSE policy.max_starts_per_hour END;
  IF (SELECT count(*) FROM public.workflow_runs WHERE organization_id=NEW.organization_id AND status='queued')>=policy.max_queued_runs THEN RAISE EXCEPTION 'Workflow quota exceeded: organization queue is full.' USING ERRCODE='P0001'; END IF;
  IF (SELECT count(*) FROM public.workflow_runs WHERE organization_id=NEW.organization_id AND status IN ('queued','running','waiting_for_input','waiting_for_event','manual_review'))>=policy.max_outstanding_runs THEN RAISE EXCEPTION 'Workflow quota exceeded: organization has too many outstanding runs.' USING ERRCODE='P0001'; END IF;
  IF (SELECT count(*) FROM public.workflow_runs WHERE organization_id=NEW.organization_id AND caller_id=NEW.caller_id AND status IN ('queued','running','waiting_for_input','waiting_for_event','manual_review'))>=caller_limit THEN RAISE EXCEPTION 'Workflow quota exceeded: caller has too many outstanding runs.' USING ERRCODE='P0001'; END IF;
  IF (SELECT count(*) FROM public.workflow_runs WHERE organization_id=NEW.organization_id AND caller_id=NEW.caller_id AND created_at>=clock_timestamp()-interval '1 hour')>=caller_hour_limit THEN RAISE EXCEPTION 'Workflow quota exceeded: caller start rate is too high.' USING ERRCODE='P0001'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.purge_terminal_workflow_state() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status IN ('succeeded','failed','cancelled','timed_out','incomplete') AND OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.run_state_ciphertext:=NULL; NEW.pending_signals:='[]'::jsonb; NEW.event_wait:=NULL;
    DELETE FROM public.workflow_run_artifacts WHERE run_id=NEW.id AND organization_id=NEW.organization_id;
  END IF;
  RETURN NEW;
END $$;
