-- Drop the security definer view and recreate with security invoker
DROP VIEW IF EXISTS public.profiles_secure;

-- Recreate with SECURITY INVOKER (respects caller's RLS policies)
CREATE VIEW public.profiles_secure 
WITH (security_invoker = true)
AS
SELECT 
  id,
  user_id,
  full_name,
  avatar_url,
  -- Email masking: full email for own profile or admins, masked for others
  CASE 
    WHEN auth.uid() = user_id THEN email
    WHEN public.is_org_admin(auth.uid(), (
      SELECT organization_id FROM public.organization_members 
      WHERE user_id = auth.uid() AND status = 'active' LIMIT 1
    )) THEN email
    ELSE SUBSTRING(email FROM 1 FOR 2) || '***@' || SPLIT_PART(email, '@', 2)
  END AS email,
  created_at,
  updated_at
FROM public.profiles;