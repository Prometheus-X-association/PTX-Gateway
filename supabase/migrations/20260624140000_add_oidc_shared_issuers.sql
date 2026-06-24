-- Shared OIDC issuers: a discovery URL (with its own custom slug and signing
-- key) that multiple organizations can attach their OIDC provider clients to,
-- instead of each organization always using its own private discovery URL.
-- Any org admin can create one (choosing the slug, checked for availability)
-- and any other org admin can join an existing one just by knowing its slug.

CREATE TABLE IF NOT EXISTS public.oidc_shared_issuers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_by_organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.oidc_shared_issuer_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_issuer_id UUID NOT NULL UNIQUE REFERENCES public.oidc_shared_issuers(id) ON DELETE CASCADE,
  kid TEXT NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'RS256',
  private_key_jwk JSONB NOT NULL,
  public_key_jwk JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Membership: which organizations have joined which shared issuer. An org
-- must be a member before it can attach its own clients to that issuer.
CREATE TABLE IF NOT EXISTS public.oidc_shared_issuer_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_issuer_id UUID NOT NULL REFERENCES public.oidc_shared_issuers(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  joined_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shared_issuer_id, organization_id)
);

CREATE INDEX IF NOT EXISTS oidc_shared_issuer_members_org_idx
  ON public.oidc_shared_issuer_members (organization_id);
CREATE INDEX IF NOT EXISTS oidc_shared_issuer_members_issuer_idx
  ON public.oidc_shared_issuer_members (shared_issuer_id);

-- A client normally authenticates against its own organization's private
-- issuer. When shared_issuer_id is set instead, it authenticates against the
-- shared issuer's key/discovery URL and is no longer reachable from the
-- organization's private endpoint. If the shared issuer is later deleted,
-- this falls back to NULL (private) rather than deleting the client.
ALTER TABLE public.oidc_provider_clients
  ADD COLUMN IF NOT EXISTS shared_issuer_id UUID REFERENCES public.oidc_shared_issuers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS oidc_provider_clients_shared_issuer_idx
  ON public.oidc_provider_clients (shared_issuer_id);

ALTER TABLE public.oidc_shared_issuers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oidc_shared_issuer_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oidc_shared_issuer_members ENABLE ROW LEVEL SECURITY;

-- No RLS policies are created on purpose, consistent with the other
-- oidc_provider_* tables: only the service-role oidc-provider edge function
-- reads/writes these, gated by its own org-admin / membership checks.
REVOKE ALL ON public.oidc_shared_issuers FROM anon;
REVOKE ALL ON public.oidc_shared_issuers FROM authenticated;
REVOKE ALL ON public.oidc_shared_issuer_keys FROM anon;
REVOKE ALL ON public.oidc_shared_issuer_keys FROM authenticated;
REVOKE ALL ON public.oidc_shared_issuer_members FROM anon;
REVOKE ALL ON public.oidc_shared_issuer_members FROM authenticated;
