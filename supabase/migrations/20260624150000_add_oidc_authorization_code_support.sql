-- Adds support for the authorization_code and refresh_token grants on top of
-- the existing client_credentials-only OIDC provider. authorization_code is
-- backed by PTX Gateway's own Supabase Auth users (the same accounts that
-- already log into the gateway/admin panel) -- there is no separate identity
-- system for this flow.

ALTER TABLE public.oidc_provider_clients
  ADD COLUMN IF NOT EXISTS redirect_uris TEXT[] NOT NULL DEFAULT '{}';

-- Short-lived, single-use authorization codes issued after a user logs in and
-- approves a client. The code itself is hashed (unlike client secrets) since
-- it is a true bearer credential with a very short lifetime and no need for
-- an admin to ever view it again after issuance.
CREATE TABLE IF NOT EXISTS public.oidc_provider_auth_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_row_id UUID NOT NULL REFERENCES public.oidc_provider_clients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  code_challenge TEXT,
  code_challenge_method TEXT,
  scope TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oidc_provider_auth_codes_client_idx
  ON public.oidc_provider_auth_codes (client_row_id);

-- Refresh tokens issued alongside an authorization_code access token. Hashed
-- for the same reason as auth codes: long-lived bearer credentials handed
-- directly to the external platform, never re-displayed in the admin UI.
CREATE TABLE IF NOT EXISTS public.oidc_provider_refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_row_id UUID NOT NULL REFERENCES public.oidc_provider_clients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  scope TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oidc_provider_refresh_tokens_client_idx
  ON public.oidc_provider_refresh_tokens (client_row_id);

ALTER TABLE public.oidc_provider_auth_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oidc_provider_refresh_tokens ENABLE ROW LEVEL SECURITY;

-- No RLS policies on purpose, consistent with the other oidc_provider_* tables:
-- only the service-role oidc-provider edge function reads/writes these.
REVOKE ALL ON public.oidc_provider_auth_codes FROM anon;
REVOKE ALL ON public.oidc_provider_auth_codes FROM authenticated;
REVOKE ALL ON public.oidc_provider_refresh_tokens FROM anon;
REVOKE ALL ON public.oidc_provider_refresh_tokens FROM authenticated;
