-- Workflow administrators do not need to choose execution capacity or a run deadline.
-- Retain legacy columns for rolling deployment and historical records.
ALTER TABLE public.workflow_runs ALTER COLUMN timeout_seconds DROP NOT NULL;
ALTER TABLE public.workflow_runs ALTER COLUMN timeout_seconds DROP DEFAULT;
UPDATE public.workflow_runs SET timeout_seconds = NULL WHERE status IN ('queued', 'waiting_for_input');
COMMENT ON COLUMN public.workflow_runs.max_concurrent_runs IS 'Legacy field; ignored by job scheduling.';
COMMENT ON COLUMN public.workflow_runs.timeout_seconds IS 'Null for independent runs with no whole-run deadline; legacy active runs may retain a deadline.';

-- Claims serialize only briefly; execution is independent with no workflow or organization cap.
-- Retain the legacy RPC argument for compatibility, but deliberately ignore it.
CREATE OR REPLACE FUNCTION public.claim_workflow_run(p_organization_limit integer DEFAULT 8)
RETURNS SETOF public.workflow_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE candidate public.workflow_runs;
BEGIN
  PERFORM pg_advisory_xact_lock(736281);
  -- An interrupted action may have succeeded remotely. Never replay it automatically.
  UPDATE public.workflow_run_steps s SET status = 'failed', error = 'Worker lease expired; external action outcome may be unknown.', finished_at = now()
  FROM public.workflow_runs r WHERE s.run_id = r.id AND s.status = 'running'
    AND r.status = 'running' AND r.lease_expires_at < now();
  UPDATE public.workflow_runs SET status = CASE WHEN cancel_requested THEN 'cancelled' ELSE 'failed' END,
    failed_node_id = current_node_id, stop_reason = 'Worker lease expired; execution interrupted. Review external actions before starting a new run.',
    finished_at = now(), updated_at = now(), lease_token = NULL
    WHERE status = 'running' AND lease_expires_at < now();
  FOR candidate IN SELECT * FROM public.workflow_runs WHERE status = 'queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LOOP
    RETURN QUERY UPDATE public.workflow_runs SET status = 'running', lease_token = gen_random_uuid(), lease_expires_at = now() + interval '60 seconds',
      started_at = coalesce(started_at, now()), updated_at = now() WHERE id = candidate.id RETURNING *;
    RETURN;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.claim_workflow_run(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_workflow_run(integer) TO service_role;
