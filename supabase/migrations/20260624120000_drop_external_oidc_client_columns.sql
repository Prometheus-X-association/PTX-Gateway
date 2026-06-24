-- The "External OIDC" client feature (PTX Gateway acting as an OIDC client toward
-- a partner IdP for outbound PDC calls) has been removed in favor of the new
-- OIDC Provider feature (PTX Gateway acting as its own token issuer). These
-- columns are no longer read or written by any function.

ALTER TABLE public.organization_pdc_secrets
  DROP COLUMN IF EXISTS oidc_client_secret,
  DROP COLUMN IF EXISTS external_oidc_access_token,
  DROP COLUMN IF EXISTS external_oidc_refresh_token,
  DROP COLUMN IF EXISTS external_oidc_id_token,
  DROP COLUMN IF EXISTS external_oidc_token_type,
  DROP COLUMN IF EXISTS external_oidc_scope,
  DROP COLUMN IF EXISTS external_oidc_subject,
  DROP COLUMN IF EXISTS external_oidc_expires_at;
