-- Operator-managed workflow quotas and automatic terminal-run retention.
CREATE TABLE public.workflow_execution_policies (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  max_queued_runs integer NOT NULL DEFAULT 200 CHECK (max_queued_runs BETWEEN 1 AND 10000),
  max_outstanding_runs integer NOT NULL DEFAULT 1000 CHECK (max_outstanding_runs BETWEEN 1 AND 100000),
  max_caller_outstanding_runs integer NOT NULL DEFAULT 100 CHECK (max_caller_outstanding_runs BETWEEN 1 AND 10000),
  max_starts_per_hour integer NOT NULL DEFAULT 1000 CHECK (max_starts_per_hour BETWEEN 1 AND 100000),
  completed_retention_days integer NOT NULL DEFAULT 30 CHECK (completed_retention_days BETWEEN 1 AND 3650),
  failed_retention_days integer NOT NULL DEFAULT 90 CHECK (failed_retention_days BETWEEN 1 AND 3650),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workflow_execution_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workflow_execution_policies FROM anon, authenticated;
GRANT ALL ON public.workflow_execution_policies TO service_role;

CREATE FUNCTION public.enforce_workflow_run_quota() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  policy public.workflow_execution_policies;
  caller_limit integer;
  caller_hour_limit integer;
BEGIN
  -- Serialize admission for an organization; the lock is released when INSERT commits.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text, 918273));
  SELECT * INTO policy FROM public.workflow_execution_policies WHERE organization_id = NEW.organization_id;
  IF NOT FOUND THEN
    policy.max_queued_runs := 200;
    policy.max_outstanding_runs := 1000;
    policy.max_caller_outstanding_runs := 100;
    policy.max_starts_per_hour := 1000;
  END IF;
  caller_limit := CASE WHEN NEW.caller_id LIKE 'public:%' THEN least(policy.max_caller_outstanding_runs, 20) ELSE policy.max_caller_outstanding_runs END;
  caller_hour_limit := CASE WHEN NEW.caller_id LIKE 'public:%' THEN least(policy.max_starts_per_hour, 100) ELSE policy.max_starts_per_hour END;

  IF (SELECT count(*) FROM public.workflow_runs WHERE organization_id = NEW.organization_id AND status = 'queued') >= policy.max_queued_runs THEN
    RAISE EXCEPTION 'Workflow quota exceeded: organization queue is full.' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.workflow_runs WHERE organization_id = NEW.organization_id AND status IN ('queued','running','waiting_for_input','manual_review')) >= policy.max_outstanding_runs THEN
    RAISE EXCEPTION 'Workflow quota exceeded: organization has too many outstanding runs.' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.workflow_runs WHERE organization_id = NEW.organization_id AND caller_id = NEW.caller_id AND status IN ('queued','running','waiting_for_input','manual_review')) >= caller_limit THEN
    RAISE EXCEPTION 'Workflow quota exceeded: caller has too many outstanding runs.' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.workflow_runs WHERE organization_id = NEW.organization_id AND caller_id = NEW.caller_id AND created_at >= clock_timestamp() - interval '1 hour') >= caller_hour_limit THEN
    RAISE EXCEPTION 'Workflow quota exceeded: caller start rate is too high.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workflow_enforce_run_quota BEFORE INSERT ON public.workflow_runs
FOR EACH ROW EXECUTE FUNCTION public.enforce_workflow_run_quota();

CREATE FUNCTION public.cleanup_workflow_runs(p_batch integer DEFAULT 500) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE removed integer;
BEGIN
  WITH expired AS (
    SELECT r.id
    FROM public.workflow_runs r
    LEFT JOIN public.workflow_execution_policies p ON p.organization_id = r.organization_id
    WHERE r.status IN ('succeeded','incomplete','cancelled','timed_out','failed')
      AND r.finished_at < clock_timestamp() - make_interval(days => CASE WHEN r.status = 'failed' THEN coalesce(p.failed_retention_days, 90) ELSE coalesce(p.completed_retention_days, 30) END)
    ORDER BY r.finished_at
    LIMIT greatest(1, least(p_batch, 5000))
    FOR UPDATE OF r SKIP LOCKED
  )
  DELETE FROM public.workflow_runs r USING expired WHERE r.id = expired.id;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END $$;

REVOKE ALL ON FUNCTION public.enforce_workflow_run_quota(), public.cleanup_workflow_runs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_workflow_runs(integer) TO service_role;

CREATE INDEX workflow_runs_org_status_created ON public.workflow_runs(organization_id, status, created_at);
CREATE INDEX workflow_runs_caller_status_created ON public.workflow_runs(organization_id, caller_id, status, created_at);
