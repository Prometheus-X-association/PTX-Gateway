-- Fix verify_admin_access to use auth.uid() directly instead of accepting user_id parameter
-- This prevents information leakage about other users' admin status

DROP FUNCTION IF EXISTS public.verify_admin_access(uuid, uuid);

CREATE OR REPLACE FUNCTION public.verify_admin_access(_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Require authentication
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Check if the authenticated user is an admin in the specified organization
  RETURN public.is_org_admin(auth.uid(), _organization_id);
END;
$$;