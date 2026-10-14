ALTER TABLE public.workflow_runs
  ADD COLUMN current_operation_id text,
  ADD COLUMN current_side_effect_class text CHECK (current_side_effect_class IN ('pure','read_only','idempotent','non_idempotent')),
  ADD COLUMN recovery_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.workflow_runs DROP CONSTRAINT workflow_runs_status_check;
ALTER TABLE public.workflow_runs ADD CONSTRAINT workflow_runs_status_check CHECK (status IN ('queued','running','waiting_for_input','manual_review','succeeded','failed','cancelled','timed_out','incomplete'));
ALTER TABLE public.workflow_run_steps
  ADD COLUMN attempt integer NOT NULL DEFAULT 1,
  ADD COLUMN operation_id text,
  ADD COLUMN side_effect_class text CHECK (side_effect_class IN ('pure','read_only','idempotent','non_idempotent'));

CREATE OR REPLACE FUNCTION public.claim_workflow_run(p_organization_limit integer DEFAULT 8)
RETURNS SETOF public.workflow_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE candidate public.workflow_runs;
BEGIN
  PERFORM pg_advisory_xact_lock(736281);

  UPDATE public.workflow_run_steps s SET status = 'failed',
    error = CASE WHEN r.cancel_requested THEN 'Execution cancelled while this node was active.' ELSE 'Worker lease expired; this safe node will resume from its last checkpoint.' END,
    finished_at = now()
  FROM public.workflow_runs r WHERE s.run_id = r.id AND s.status = 'running'
    AND r.status = 'running' AND r.lease_expires_at < now();

  -- Safe nodes resume from the checkpoint before the interrupted node. Stable
  -- operation IDs make explicitly idempotent external actions safe to repeat.
  UPDATE public.workflow_runs SET status = 'queued', recovery_count = recovery_count + 1,
    stop_reason = 'Worker lease expired; queued to resume from the last checkpoint.',
    current_node_id = NULL, current_operation_id = NULL, current_side_effect_class = NULL,
    lease_token = NULL, lease_expires_at = NULL, updated_at = now()
  WHERE status = 'running' AND lease_expires_at < now() AND NOT cancel_requested
    AND recovery_count < 3
    AND (current_node_id IS NULL OR current_side_effect_class IN ('pure','read_only','idempotent'));

  UPDATE public.workflow_runs SET status = CASE WHEN cancel_requested THEN 'cancelled' WHEN recovery_count >= 3 THEN 'failed' ELSE 'manual_review' END,
    failed_node_id = current_node_id,
    stop_reason = CASE WHEN cancel_requested THEN 'Cancelled while worker lease expired.' WHEN recovery_count >= 3 THEN 'Worker recovery limit exhausted.' ELSE 'Worker lease expired during a non-idempotent action; external outcome may be unknown.' END,
    finished_at = CASE WHEN cancel_requested OR recovery_count >= 3 THEN now() ELSE NULL END, updated_at = now(), lease_token = NULL, lease_expires_at = NULL
  WHERE status = 'running' AND lease_expires_at < now();

  FOR candidate IN SELECT * FROM public.workflow_runs WHERE status = 'queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LOOP
    RETURN QUERY UPDATE public.workflow_runs SET status = 'running', lease_token = gen_random_uuid(), lease_expires_at = now() + interval '60 seconds',
      started_at = coalesce(started_at, now()), updated_at = now() WHERE id = candidate.id RETURNING *;
    RETURN;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.claim_workflow_run(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_workflow_run(integer) TO service_role;
