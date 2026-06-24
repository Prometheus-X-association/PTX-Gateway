-- OIDC Provider feature: lets PTX Gateway act as its own token-issuing
-- authority (like a minimal Keycloak realm) per organization. External
-- platforms register a client_id/client_secret pair here, then call the
-- gateway's discovery + token endpoints to mint a signed RS256 JWT.
-- This is a pure token-minting service: PTX does not itself validate or
-- gate any resource with these tokens.

CREATE TABLE IF NOT EXISTS public.oidc_provider_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  kid TEXT NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'RS256',
  private_key_jwk JSONB NOT NULL,
  public_key_jwk JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.oidc_provider_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  client_id TEXT NOT NULL UNIQUE,
  client_secret_hash TEXT NOT NULL,
  audience TEXT,
  token_expiry_seconds INTEGER NOT NULL DEFAULT 3600,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oidc_provider_clients_organization_idx
  ON public.oidc_provider_clients (organization_id);

CREATE OR REPLACE FUNCTION public.set_oidc_provider_clients_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_oidc_provider_clients_updated_at ON public.oidc_provider_clients;
CREATE TRIGGER trg_oidc_provider_clients_updated_at
BEFORE UPDATE ON public.oidc_provider_clients
FOR EACH ROW
EXECUTE FUNCTION public.set_oidc_provider_clients_updated_at();

ALTER TABLE public.oidc_provider_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oidc_provider_clients ENABLE ROW LEVEL SECURITY;

-- No RLS policies are created on purpose.
-- Only the service-role oidc-provider edge function reads/writes these tables;
-- the discovery/JWKS/token endpoints it exposes are public but only ever
-- return the public key and minted tokens, never the private key or secret hash.
REVOKE ALL ON public.oidc_provider_keys FROM anon;
REVOKE ALL ON public.oidc_provider_keys FROM authenticated;
REVOKE ALL ON public.oidc_provider_clients FROM anon;
REVOKE ALL ON public.oidc_provider_clients FROM authenticated;
