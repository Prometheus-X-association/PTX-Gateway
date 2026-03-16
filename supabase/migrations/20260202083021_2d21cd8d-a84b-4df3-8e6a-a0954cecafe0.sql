-- Add server-side admin verification RPC for defense-in-depth
-- This allows client-side code to explicitly verify admin status before critical operations

CREATE OR REPLACE FUNCTION public.verify_admin_access(
  _user_id UUID,
  _organization_id UUID
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN public.is_org_admin(_user_id, _organization_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;