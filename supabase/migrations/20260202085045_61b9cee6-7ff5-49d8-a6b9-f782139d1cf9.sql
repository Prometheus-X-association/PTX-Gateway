-- Create a function to mask email addresses for non-admin users
-- This provides defense-in-depth against email harvesting

CREATE OR REPLACE FUNCTION public.mask_email(email text, viewer_id uuid, profile_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  viewer_org_id uuid;
  is_admin boolean := false;
BEGIN
  -- If viewing own profile, show full email
  IF viewer_id = profile_user_id THEN
    RETURN email;
  END IF;
  
  -- Get viewer's organization
  SELECT organization_id INTO viewer_org_id
  FROM public.organization_members
  WHERE user_id = viewer_id AND status = 'active'
  LIMIT 1;
  
  -- Check if viewer is admin in their org
  IF viewer_org_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = viewer_id
        AND organization_id = viewer_org_id
        AND role IN ('admin', 'super_admin')
    ) INTO is_admin;
  END IF;
  
  -- Admins see full email, others see masked version
  IF is_admin THEN
    RETURN email;
  ELSE
    -- Mask email: show first 2 chars + *** + domain
    IF email IS NULL OR email = '' THEN
      RETURN email;
    END IF;
    RETURN SUBSTRING(email FROM 1 FOR 2) || '***@' || SPLIT_PART(email, '@', 2);
  END IF;
END;
$$;

-- Create a secure view for profile access that masks emails for non-admins
CREATE OR REPLACE VIEW public.profiles_secure AS
SELECT 
  id,
  user_id,
  full_name,
  avatar_url,
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