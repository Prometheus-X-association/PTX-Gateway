-- Per-organization secure storage for PDC bearer tokens.
-- Tokens are never exposed through normal client table reads.

CREATE TABLE IF NOT EXISTS public.organization_pdc_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  bearer_token TEXT NOT NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organization_pdc_secrets_organization_idx
  ON public.organization_pdc_secrets (organization_id);

CREATE OR REPLACE FUNCTION public.set_organization_pdc_secrets_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organization_pdc_secrets_updated_at ON public.organization_pdc_secrets;
CREATE TRIGGER trg_organization_pdc_secrets_updated_at
BEFORE UPDATE ON public.organization_pdc_secrets
FOR EACH ROW
EXECUTE FUNCTION public.set_organization_pdc_secrets_updated_at();

ALTER TABLE public.organization_pdc_secrets ENABLE ROW LEVEL SECURITY;

-- No RLS policies are created on purpose.
-- Only service-role edge functions should read/write this table.
REVOKE ALL ON public.organization_pdc_secrets FROM anon;
REVOKE ALL ON public.organization_pdc_secrets FROM authenticated;

