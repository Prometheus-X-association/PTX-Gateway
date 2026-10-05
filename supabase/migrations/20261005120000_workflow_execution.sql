-- Run snapshots and full inputs are private; only the service exposes redacted views.
CREATE TABLE public.workflow_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  workflow_ids text[] NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.workflow_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workflow_id text NOT NULL,
  name text NOT NULL,
  secret_ciphertext text NOT NULL,
  input_mapping jsonb NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workflow_id text NOT NULL,
  workflow_name text NOT NULL,
  caller_id text NOT NULL,
  caller_user_id uuid,
  trigger_source text NOT NULL CHECK (trigger_source IN ('dashboard', 'api', 'webhook')),
  webhook_id uuid REFERENCES public.workflow_webhooks(id) ON DELETE SET NULL,
  delivery_id text,
  idempotency_key text,
  request_hash text NOT NULL,
  snapshot jsonb NOT NULL,
  input jsonb NOT NULL,
  checkpoint jsonb,
  waiting jsonb,
  resume_answer text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','waiting_for_input','succeeded','failed','cancelled','timed_out','incomplete')),
  current_node_id text,
  last_node_id text,
  failed_node_id text,
  stop_reason text,
  output jsonb,
  render_as text,
  cancel_requested boolean NOT NULL DEFAULT false,
  lease_token uuid,
  lease_expires_at timestamptz,
  timeout_seconds integer NOT NULL DEFAULT 900 CHECK (timeout_seconds BETWEEN 10 AND 3600),
  execution_ms bigint NOT NULL DEFAULT 0,
  max_concurrent_runs integer NOT NULL DEFAULT 4 CHECK (max_concurrent_runs BETWEEN 1 AND 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX workflow_runs_idempotency ON public.workflow_runs
  (organization_id, caller_id, workflow_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX workflow_runs_queue ON public.workflow_runs (created_at) WHERE status = 'queued';
CREATE INDEX workflow_runs_org_history ON public.workflow_runs (organization_id, workflow_id, created_at DESC);
CREATE TABLE public.workflow_run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  run_id uuid NOT NULL,
  sequence integer NOT NULL,
  node_id text NOT NULL,
  node_name text NOT NULL,
  node_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('running','succeeded','failed','waiting','cancelled','timed_out')),
  input_summary jsonb,
  output_summary jsonb,
  error text,
  selected_routes jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  FOREIGN KEY (run_id, organization_id) REFERENCES public.workflow_runs(id, organization_id) ON DELETE CASCADE,
  UNIQUE (run_id, sequence)
);
ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_webhooks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workflow_runs, public.workflow_run_steps, public.workflow_api_keys, public.workflow_webhooks FROM anon, authenticated;
GRANT ALL ON public.workflow_runs, public.workflow_run_steps, public.workflow_api_keys, public.workflow_webhooks TO service_role;

-- All workers share this short transaction lock. It serializes claims, not execution.
CREATE FUNCTION public.claim_workflow_run(p_organization_limit integer DEFAULT 8)
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
    IF (SELECT count(*) FROM public.workflow_runs WHERE organization_id = candidate.organization_id AND status = 'running') >= greatest(1, least(p_organization_limit, 64)) THEN CONTINUE; END IF;
    IF (SELECT count(*) FROM public.workflow_runs WHERE organization_id = candidate.organization_id AND workflow_id = candidate.workflow_id AND status = 'running') >= candidate.max_concurrent_runs THEN CONTINUE; END IF;
    RETURN QUERY UPDATE public.workflow_runs SET status = 'running', lease_token = gen_random_uuid(), lease_expires_at = now() + interval '60 seconds',
      started_at = coalesce(started_at, now()), updated_at = now() WHERE id = candidate.id RETURNING *;
    RETURN;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.claim_workflow_run(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_workflow_run(integer) TO service_role;
