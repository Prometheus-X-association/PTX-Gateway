-- Organization-scoped admission and active-execution controls. High schema
-- ceilings allow large installations to scale, while conservative saved
-- defaults and the dashboard recommendation protect smaller deployments.
ALTER TABLE public.workflow_execution_policies
  DROP CONSTRAINT IF EXISTS workflow_execution_policies_max_queued_runs_check,
  DROP CONSTRAINT IF EXISTS workflow_execution_policies_max_outstanding_runs_check,
  DROP CONSTRAINT IF EXISTS workflow_execution_policies_max_caller_outstanding_runs_check,
  DROP CONSTRAINT IF EXISTS workflow_execution_policies_max_starts_per_hour_check;

ALTER TABLE public.workflow_execution_policies
  ADD COLUMN max_running_runs integer NOT NULL DEFAULT 64,
  ADD CONSTRAINT workflow_execution_policies_max_running_runs_check CHECK (max_running_runs BETWEEN 1 AND 100000),
  ADD CONSTRAINT workflow_execution_policies_max_queued_runs_check CHECK (max_queued_runs BETWEEN 1 AND 1000000),
  ADD CONSTRAINT workflow_execution_policies_max_outstanding_runs_check CHECK (max_outstanding_runs BETWEEN 1 AND 2000000),
  ADD CONSTRAINT workflow_execution_policies_max_caller_outstanding_runs_check CHECK (max_caller_outstanding_runs BETWEEN 1 AND 1000000),
  ADD CONSTRAINT workflow_execution_policies_max_starts_per_hour_check CHECK (max_starts_per_hour BETWEEN 1 AND 10000000);

CREATE OR REPLACE FUNCTION public.enforce_workflow_run_quota() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE policy public.workflow_execution_policies; caller_limit integer; caller_hour_limit integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text,918273));
  SELECT * INTO policy FROM public.workflow_execution_policies WHERE organization_id=NEW.organization_id;
  IF NOT FOUND THEN
    policy.max_queued_runs:=200; policy.max_outstanding_runs:=1000;
    policy.max_caller_outstanding_runs:=100; policy.max_starts_per_hour:=1000;
  END IF;
  caller_limit:=CASE WHEN NEW.caller_id LIKE 'public:%' THEN least(policy.max_caller_outstanding_runs,20) ELSE policy.max_caller_outstanding_runs END;
  caller_hour_limit:=CASE WHEN NEW.caller_id LIKE 'public:%' THEN least(policy.max_starts_per_hour,100) ELSE policy.max_starts_per_hour END;
  IF (SELECT count(*) FROM public.workflow_runs WHERE organization_id=NEW.organization_id AND status='queued')>=policy.max_queued_runs THEN RAISE EXCEPTION 'Workflow quota exceeded: organization queue is full.' USING ERRCODE='P0001'; END IF;
  IF (SELECT count(*) FROM public.workflow_runs WHERE organization_id=NEW.organization_id AND status IN ('queued','running','waiting_for_input','waiting_for_event','manual_review'))>=policy.max_outstanding_runs THEN RAISE EXCEPTION 'Workflow quota exceeded: organization has too many outstanding runs.' USING ERRCODE='P0001'; END IF;
  IF (SELECT count(*) FROM public.workflow_runs WHERE organization_id=NEW.organization_id AND caller_id=NEW.caller_id AND status IN ('queued','running','waiting_for_input','waiting_for_event','manual_review'))>=caller_limit THEN RAISE EXCEPTION 'Workflow quota exceeded: caller has too many outstanding runs.' USING ERRCODE='P0001'; END IF;
  IF (SELECT count(*) FROM public.workflow_runs WHERE organization_id=NEW.organization_id AND caller_id=NEW.caller_id AND created_at>=clock_timestamp()-interval '1 hour')>=caller_hour_limit THEN RAISE EXCEPTION 'Workflow quota exceeded: caller start rate is too high.' USING ERRCODE='P0001'; END IF;
  RETURN NEW;
END $$;

-- Claims no longer take one global blocking advisory lock. Row locks prevent
-- duplicate ownership, while a short organization lock makes the configured
-- running count exact even when many worker replicas claim simultaneously.
CREATE OR REPLACE FUNCTION public.claim_workflow_run(p_organization_limit integer DEFAULT 8)
RETURNS SETOF public.workflow_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE candidate public.workflow_runs; running_limit integer; expired_ids uuid[];
BEGIN
  -- Only one claimant performs bounded stale-lease recovery; other claimants
  -- continue dispatching instead of waiting behind maintenance.
  IF pg_try_advisory_xact_lock(736281) THEN
    SELECT coalesce(array_agg(id),ARRAY[]::uuid[]) INTO expired_ids FROM (
      SELECT id FROM public.workflow_runs WHERE status='running' AND lease_expires_at<clock_timestamp()
      ORDER BY lease_expires_at FOR UPDATE SKIP LOCKED LIMIT 500
    ) expired;
    UPDATE public.workflow_run_steps s SET status='failed',
      error=CASE WHEN r.cancel_requested THEN 'Execution cancelled while this node was active.' ELSE 'Worker lease expired; this safe node will resume from its last checkpoint.' END,
      finished_at=clock_timestamp()
    FROM public.workflow_runs r WHERE r.id=ANY(expired_ids) AND s.run_id=r.id AND s.status='running' AND r.status='running' AND r.lease_expires_at<clock_timestamp();
    UPDATE public.workflow_runs SET status='queued',recovery_count=recovery_count+1,
      stop_reason='Worker lease expired; queued to resume from the last checkpoint.',current_node_id=NULL,current_operation_id=NULL,current_side_effect_class=NULL,
      lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
    WHERE id=ANY(expired_ids) AND status='running' AND lease_expires_at<clock_timestamp() AND NOT cancel_requested AND recovery_count<3
      AND (current_node_id IS NULL OR current_side_effect_class IN ('pure','read_only','idempotent'));
    UPDATE public.workflow_runs SET status=CASE WHEN cancel_requested THEN 'cancelled' WHEN recovery_count>=3 THEN 'failed' ELSE 'manual_review' END,
      failed_node_id=current_node_id,
      stop_reason=CASE WHEN cancel_requested THEN 'Cancelled while worker lease expired.' WHEN recovery_count>=3 THEN 'Worker recovery limit exhausted.' ELSE 'Worker lease expired during a non-idempotent action; external outcome may be unknown.' END,
      finished_at=CASE WHEN cancel_requested OR recovery_count>=3 THEN clock_timestamp() ELSE NULL END,updated_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL
    WHERE id=ANY(expired_ids) AND status='running' AND lease_expires_at<clock_timestamp();
  END IF;

  FOR candidate IN
    SELECT * FROM public.workflow_runs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 500
  LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended(candidate.organization_id::text,736282)) THEN CONTINUE; END IF;
    SELECT coalesce(max_running_runs,64) INTO running_limit FROM public.workflow_execution_policies WHERE organization_id=candidate.organization_id;
    running_limit:=coalesce(running_limit,64);
    IF (SELECT count(*) FROM public.workflow_runs WHERE organization_id=candidate.organization_id AND status='running')>=running_limit THEN CONTINUE; END IF;
    RETURN QUERY UPDATE public.workflow_runs SET status='running',lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '60 seconds',
      started_at=coalesce(started_at,clock_timestamp()),updated_at=clock_timestamp() WHERE id=candidate.id AND status='queued' RETURNING *;
    RETURN;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.claim_workflow_run(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_workflow_run(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.workflow_execution_policy(p_organization_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object(
    'maxRunningRuns',coalesce(p.max_running_runs,64),
    'maxQueuedRuns',coalesce(p.max_queued_runs,200),
    'maxOutstandingRuns',coalesce(p.max_outstanding_runs,1000),
    'maxCallerOutstandingRuns',coalesce(p.max_caller_outstanding_runs,100),
    'maxStartsPerHour',coalesce(p.max_starts_per_hour,1000),
    'completedRetentionDays',coalesce(p.completed_retention_days,30),
    'failedRetentionDays',coalesce(p.failed_retention_days,90))
  FROM (SELECT 1) seed LEFT JOIN public.workflow_execution_policies p ON p.organization_id=p_organization_id
$$;
REVOKE ALL ON FUNCTION public.workflow_execution_policy(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_execution_policy(uuid) TO service_role;
