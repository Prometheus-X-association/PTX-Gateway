-- Credentials and sessions are accessible only through the service-role edge function.
CREATE TABLE public.gateway_browser_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  username text NOT NULL CHECK (length(username) BETWEEN 1 AND 100),
  password_hash text NOT NULL,
  valid_from timestamptz,
  expires_at timestamptz,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, username),
  CHECK (valid_from IS NULL OR expires_at IS NULL OR valid_from < expires_at)
);
CREATE TABLE public.gateway_browser_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id uuid NOT NULL REFERENCES public.gateway_browser_credentials(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.gateway_browser_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  username text,
  event text NOT NULL,
  ip_address text,
  user_agent text,
  url text,
  referrer text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gateway_browser_logs_org_time ON public.gateway_browser_access_logs(organization_id, created_at DESC);
ALTER TABLE public.gateway_browser_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gateway_browser_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gateway_browser_access_logs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.gateway_hash_password(password text) RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = public, extensions
AS $$ SELECT crypt(password, gen_salt('bf', 10)); $$;
CREATE OR REPLACE FUNCTION public.gateway_check_password(password text, hash text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public, extensions
AS $$ SELECT crypt(password, hash) = hash; $$;
REVOKE ALL ON FUNCTION public.gateway_hash_password(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gateway_check_password(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_hash_password(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.gateway_check_password(text, text) TO service_role;
