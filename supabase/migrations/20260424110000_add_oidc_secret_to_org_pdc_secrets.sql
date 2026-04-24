-- Allow per-organization external OIDC client credentials for outbound PDC calls.

ALTER TABLE public.organization_pdc_secrets
  ALTER COLUMN bearer_token DROP NOT NULL;

ALTER TABLE public.organization_pdc_secrets
  ADD COLUMN IF NOT EXISTS oidc_client_secret TEXT;
