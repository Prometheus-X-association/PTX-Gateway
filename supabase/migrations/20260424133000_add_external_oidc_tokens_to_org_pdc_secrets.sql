-- Persist per-organization authorization-code OIDC tokens for outbound partner API access.

ALTER TABLE public.organization_pdc_secrets
  ADD COLUMN IF NOT EXISTS external_oidc_access_token TEXT,
  ADD COLUMN IF NOT EXISTS external_oidc_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS external_oidc_id_token TEXT,
  ADD COLUMN IF NOT EXISTS external_oidc_token_type TEXT,
  ADD COLUMN IF NOT EXISTS external_oidc_scope TEXT,
  ADD COLUMN IF NOT EXISTS external_oidc_subject TEXT,
  ADD COLUMN IF NOT EXISTS external_oidc_expires_at TIMESTAMPTZ;
