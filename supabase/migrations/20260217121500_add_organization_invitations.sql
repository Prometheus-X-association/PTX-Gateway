-- Organization invitations for email-based onboarding
CREATE TABLE IF NOT EXISTS public.organization_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role public.app_role NOT NULL DEFAULT 'user',
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  token UUID NOT NULL DEFAULT gen_random_uuid(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_invitations_org_email_unique_idx
  ON public.organization_invitations (organization_id, email);

CREATE INDEX IF NOT EXISTS organization_invitations_email_idx
  ON public.organization_invitations (lower(email));

CREATE INDEX IF NOT EXISTS organization_invitations_org_idx
  ON public.organization_invitations (organization_id);

ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view invitations in their org" ON public.organization_invitations;
CREATE POLICY "Admins can view invitations in their org"
ON public.organization_invitations FOR SELECT
USING (public.is_org_admin(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Admins can manage invitations in their org" ON public.organization_invitations;
CREATE POLICY "Admins can manage invitations in their org"
ON public.organization_invitations FOR INSERT
WITH CHECK (public.is_org_admin(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Admins can update invitations in their org" ON public.organization_invitations;
CREATE POLICY "Admins can update invitations in their org"
ON public.organization_invitations FOR UPDATE
USING (public.is_org_admin(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Admins can delete invitations in their org" ON public.organization_invitations;
CREATE POLICY "Admins can delete invitations in their org"
ON public.organization_invitations FOR DELETE
USING (public.is_org_admin(auth.uid(), organization_id));

-- Accept all pending invitations for the current authenticated user email.
CREATE OR REPLACE FUNCTION public.accept_my_pending_invitations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _email TEXT;
  _accepted_count INTEGER := 0;
  rec RECORD;
BEGIN
  IF _uid IS NULL THEN
    RETURN 0;
  END IF;

  SELECT lower(u.email) INTO _email
  FROM auth.users u
  WHERE u.id = _uid;

  IF _email IS NULL OR _email = '' THEN
    RETURN 0;
  END IF;

  FOR rec IN
    SELECT id, organization_id, role
    FROM public.organization_invitations
    WHERE lower(email) = _email
      AND status = 'pending'
      AND expires_at > now()
  LOOP
    INSERT INTO public.organization_members (organization_id, user_id, invited_by, status)
    SELECT i.organization_id, _uid, i.invited_by, 'active'
    FROM public.organization_invitations i
    WHERE i.id = rec.id
    ON CONFLICT (organization_id, user_id) DO NOTHING;

    INSERT INTO public.user_roles (user_id, organization_id, role)
    VALUES (_uid, rec.organization_id, rec.role)
    ON CONFLICT (user_id, organization_id)
    DO UPDATE SET role = EXCLUDED.role;

    UPDATE public.organization_invitations
    SET status = 'accepted',
        accepted_at = now()
    WHERE id = rec.id;

    _accepted_count := _accepted_count + 1;
  END LOOP;

  UPDATE public.organization_invitations
  SET status = 'expired'
  WHERE status = 'pending'
    AND expires_at <= now();

  RETURN _accepted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_my_pending_invitations() TO authenticated;
