CREATE TABLE public.workflow_worker_heartbeats (
  worker_id uuid PRIMARY KEY,
  active_runs integer NOT NULL,
  capacity integer NOT NULL,
  version text NOT NULL,
  started_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL
);
ALTER TABLE public.workflow_worker_heartbeats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workflow_worker_heartbeats FROM anon, authenticated;
GRANT ALL ON public.workflow_worker_heartbeats TO service_role;

CREATE FUNCTION public.workflow_health(p_organization_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'workers', coalesce((SELECT jsonb_agg(jsonb_build_object('workerId',worker_id,'activeRuns',active_runs,'capacity',capacity,'version',version,'startedAt',started_at,'lastSeenAt',last_seen_at)) FROM public.workflow_worker_heartbeats WHERE last_seen_at > clock_timestamp() - interval '30 seconds'),'[]'::jsonb),
    'queueDepth', (SELECT count(*) FROM public.workflow_runs WHERE organization_id=p_organization_id AND status='queued'),
    'oldestQueuedAt', (SELECT min(created_at) FROM public.workflow_runs WHERE organization_id=p_organization_id AND status='queued'),
    'runningRuns', (SELECT count(*) FROM public.workflow_runs WHERE organization_id=p_organization_id AND status='running'),
    'waitingRuns', (SELECT count(*) FROM public.workflow_runs WHERE organization_id=p_organization_id AND status='waiting_for_input'),
    'manualReviewRuns', (SELECT count(*) FROM public.workflow_runs WHERE organization_id=p_organization_id AND status='manual_review'),
    'expiredLeases', (SELECT count(*) FROM public.workflow_runs WHERE organization_id=p_organization_id AND status='running' AND lease_expires_at < clock_timestamp()),
    'notificationBacklog', (SELECT count(*) FROM public.workflow_notifications WHERE organization_id=p_organization_id AND status IN ('pending','delivering'))
  )
$$;

CREATE FUNCTION public.cleanup_workflow_worker_heartbeats() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE removed integer;
BEGIN
  DELETE FROM public.workflow_worker_heartbeats WHERE last_seen_at < clock_timestamp() - interval '7 days';
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END $$;

REVOKE ALL ON FUNCTION public.workflow_health(uuid), public.cleanup_workflow_worker_heartbeats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_health(uuid), public.cleanup_workflow_worker_heartbeats() TO service_role;
