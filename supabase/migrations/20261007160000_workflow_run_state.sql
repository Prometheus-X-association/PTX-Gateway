-- Encrypted, execution-scoped workflow state. Values are encrypted by the
-- worker; PostgreSQL only coordinates versions and lifecycle.
ALTER TABLE public.workflow_runs
  ADD COLUMN run_state_ciphertext text,
  ADD COLUMN state_version bigint NOT NULL DEFAULT 0 CHECK (state_version >= 0);

CREATE FUNCTION public.update_workflow_run_state(
  p_run_id uuid,
  p_organization_id uuid,
  p_lease_token uuid,
  p_expected_version bigint,
  p_ciphertext text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE next_version bigint;
BEGIN
  IF p_ciphertext IS NULL OR length(p_ciphertext) < 10 OR length(p_ciphertext) > 30000000 THEN
    RAISE EXCEPTION 'Invalid encrypted workflow state.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.workflow_runs
  SET run_state_ciphertext = p_ciphertext,
      state_version = state_version + 1,
      updated_at = clock_timestamp()
  WHERE id = p_run_id
    AND organization_id = p_organization_id
    AND lease_token = p_lease_token
    AND status = 'running'
    AND lease_expires_at > clock_timestamp()
    AND state_version = p_expected_version
  RETURNING state_version INTO next_version;
  IF next_version IS NULL THEN
    RAISE EXCEPTION 'Workflow state version or lease changed.' USING ERRCODE = '40001';
  END IF;
  RETURN next_version;
END $$;

REVOKE ALL ON FUNCTION public.update_workflow_run_state(uuid,uuid,uuid,bigint,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_workflow_run_state(uuid,uuid,uuid,bigint,text) TO service_role;

COMMENT ON COLUMN public.workflow_runs.run_state_ciphertext IS 'AES-GCM encrypted state scoped to this execution; never exposed by the public run API.';
COMMENT ON COLUMN public.workflow_runs.state_version IS 'Optimistic concurrency version for execution-scoped state commits.';
