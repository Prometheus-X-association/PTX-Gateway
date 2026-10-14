CREATE TABLE public.workflow_run_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  run_id uuid NOT NULL,
  node_id text NOT NULL,
  state_key text NOT NULL,
  content_type text NOT NULL DEFAULT 'application/json',
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 0 AND 26214400),
  sha256 text NOT NULL,
  ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (run_id, organization_id) REFERENCES public.workflow_runs(id, organization_id) ON DELETE CASCADE
);
ALTER TABLE public.workflow_run_artifacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workflow_run_artifacts FROM anon, authenticated;
GRANT ALL ON public.workflow_run_artifacts TO service_role;
CREATE INDEX workflow_run_artifacts_run ON public.workflow_run_artifacts(organization_id,run_id,created_at);
