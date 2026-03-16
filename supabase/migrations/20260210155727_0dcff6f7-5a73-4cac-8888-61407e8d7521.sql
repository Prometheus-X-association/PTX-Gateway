
-- Add description column to organizations
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS description text;

COMMENT ON COLUMN public.organizations.description IS 'Optional description for the organization';

-- Update existing organizations with UUID-based slugs if they have human-readable slugs
-- (We won't force-update existing slugs, but new ones will default to UUID)

-- Create a function to check slug uniqueness (used by the app)
CREATE OR REPLACE FUNCTION public.is_slug_available(_slug text, _exclude_org_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.organizations
    WHERE slug = _slug
      AND (_exclude_org_id IS NULL OR id != _exclude_org_id)
  )
$$;

-- Create a function for super_admin to update organization details
CREATE OR REPLACE FUNCTION public.update_organization(
  _org_id uuid,
  _name text,
  _slug text,
  _description text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Verify caller is super_admin of this org
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND organization_id = _org_id
      AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Only super admins can update organization details';
  END IF;

  -- Check slug uniqueness
  IF NOT public.is_slug_available(_slug, _org_id) THEN
    RAISE EXCEPTION 'This slug is already in use by another organization';
  END IF;

  UPDATE public.organizations
  SET name = _name,
      slug = _slug,
      description = _description,
      updated_at = now()
  WHERE id = _org_id;
END;
$$;

-- Create a function for super_admin to delete organization
CREATE OR REPLACE FUNCTION public.delete_organization(_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Verify caller is super_admin of this org
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND organization_id = _org_id
      AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Only super admins can delete an organization';
  END IF;

  -- Delete in order: roles, members, configs, then org
  DELETE FROM public.debug_sessions WHERE organization_id = _org_id;
  DELETE FROM public.pdc_execution_logs WHERE organization_id = _org_id;
  DELETE FROM public.param_placeholders WHERE organization_id = _org_id;
  DELETE FROM public.dataspace_params WHERE organization_id = _org_id;
  DELETE FROM public.service_chains WHERE organization_id = _org_id;
  DELETE FROM public.dataspace_configs WHERE organization_id = _org_id;
  DELETE FROM public.global_configs WHERE organization_id = _org_id;
  DELETE FROM public.user_roles WHERE organization_id = _org_id;
  DELETE FROM public.organization_members WHERE organization_id = _org_id;
  DELETE FROM public.organizations WHERE id = _org_id;
END;
$$;
