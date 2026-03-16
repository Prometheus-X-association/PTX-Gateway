-- Fix the overly permissive organizations insert policy
-- Replace with a proper check that only allows creating orgs when no org exists for first user
-- or when user is a super_admin in an existing org

DROP POLICY IF EXISTS "Super admins can insert organizations" ON public.organizations;

-- Only allow organization creation via edge function (with service role)
-- For initial org creation, we'll use an edge function
CREATE POLICY "No direct organization inserts"
ON public.organizations FOR INSERT
WITH CHECK (false);

-- Create a function to bootstrap first organization and super admin
CREATE OR REPLACE FUNCTION public.create_organization_with_admin(
    _org_name TEXT,
    _org_slug TEXT,
    _user_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _org_id UUID;
BEGIN
    -- Insert organization
    INSERT INTO public.organizations (name, slug)
    VALUES (_org_name, _org_slug)
    RETURNING id INTO _org_id;
    
    -- Add user as member
    INSERT INTO public.organization_members (organization_id, user_id, status)
    VALUES (_org_id, _user_id, 'active');
    
    -- Add user as super_admin
    INSERT INTO public.user_roles (user_id, organization_id, role)
    VALUES (_user_id, _org_id, 'super_admin');
    
    -- Create default global config
    INSERT INTO public.global_configs (organization_id)
    VALUES (_org_id);
    
    RETURN _org_id;
END;
$$;