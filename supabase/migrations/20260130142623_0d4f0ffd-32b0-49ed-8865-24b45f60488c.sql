-- Create role enum
CREATE TYPE public.app_role AS ENUM ('super_admin', 'admin', 'user');

-- Create visualization type enum
CREATE TYPE public.visualization_type AS ENUM ('upload_document', 'manual_json_input', 'data_api');

-- Create organizations table for multi-tenancy
CREATE TABLE public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create user_roles table (as per security guidelines)
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL DEFAULT 'user',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE (user_id, organization_id)
);

-- Create profiles table for user information
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    email TEXT,
    full_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create organization_members junction table
CREATE TABLE public.organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    invited_by UUID REFERENCES auth.users(id),
    status TEXT DEFAULT 'active' CHECK (status IN ('pending', 'active', 'suspended')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE (organization_id, user_id)
);

-- Create debug_sessions table for per-user debug mode
CREATE TABLE public.debug_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + interval '24 hours'),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE (user_id, organization_id)
);

-- Modify dataspace_configs to be organization-scoped
ALTER TABLE public.dataspace_configs 
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS bearer_token_secret_name TEXT,
ADD COLUMN IF NOT EXISTS fallback_result_url TEXT;

-- Modify dataspace_params to include new fields
ALTER TABLE public.dataspace_params
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS visualization_type visualization_type DEFAULT 'data_api',
ADD COLUMN IF NOT EXISTS param_actions TEXT[] DEFAULT '{}';

-- Modify service_chains to be organization-scoped
ALTER TABLE public.service_chains
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS visualization_type visualization_type DEFAULT 'data_api';

-- Modify pdc_execution_logs to be organization-scoped
ALTER TABLE public.pdc_execution_logs
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- Create global_config table for organization-specific global settings
CREATE TABLE public.global_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL UNIQUE,
    app_name TEXT DEFAULT 'Data Analytics Platform',
    app_version TEXT DEFAULT '1.0.0',
    environment TEXT DEFAULT 'production' CHECK (environment IN ('development', 'staging', 'production')),
    features JSONB DEFAULT '{"enableFileUpload": true, "enableApiConnections": true, "enableTextInput": true, "enableCustomApi": true, "maxFileSizeMB": 50, "maxFilesCount": 10}'::jsonb,
    logging JSONB DEFAULT '{"enabled": true, "level": "info"}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on all new tables
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debug_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.global_configs ENABLE ROW LEVEL SECURITY;

-- Security definer function to check user role in organization
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _organization_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = _user_id
          AND organization_id = _organization_id
          AND role = _role
    )
$$;

-- Function to check if user is admin or super_admin
CREATE OR REPLACE FUNCTION public.is_org_admin(_user_id UUID, _organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = _user_id
          AND organization_id = _organization_id
          AND role IN ('admin', 'super_admin')
    )
$$;

-- Function to get user's organization ID
CREATE OR REPLACE FUNCTION public.get_user_organization(_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT organization_id FROM public.organization_members
    WHERE user_id = _user_id AND status = 'active'
    LIMIT 1
$$;

-- Function to check if user is member of organization
CREATE OR REPLACE FUNCTION public.is_org_member(_user_id UUID, _organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE user_id = _user_id
          AND organization_id = _organization_id
          AND status = 'active'
    )
$$;

-- RLS Policies for organizations
CREATE POLICY "Users can view their organizations"
ON public.organizations FOR SELECT
USING (public.is_org_member(auth.uid(), id));

CREATE POLICY "Admins can update their organization"
ON public.organizations FOR UPDATE
USING (public.is_org_admin(auth.uid(), id));

CREATE POLICY "Super admins can insert organizations"
ON public.organizations FOR INSERT
WITH CHECK (true);

-- RLS Policies for user_roles
CREATE POLICY "Users can view roles in their org"
ON public.user_roles FOR SELECT
USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "Admins can manage roles in their org"
ON public.user_roles FOR INSERT
WITH CHECK (public.is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can update roles in their org"
ON public.user_roles FOR UPDATE
USING (public.is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can delete roles in their org"
ON public.user_roles FOR DELETE
USING (public.is_org_admin(auth.uid(), organization_id));

-- RLS Policies for profiles
CREATE POLICY "Users can view all profiles"
ON public.profiles FOR SELECT
USING (true);

CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own profile"
ON public.profiles FOR INSERT
WITH CHECK (user_id = auth.uid());

-- RLS Policies for organization_members
CREATE POLICY "Users can view members in their org"
ON public.organization_members FOR SELECT
USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "Admins can manage members in their org"
ON public.organization_members FOR INSERT
WITH CHECK (public.is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can update members in their org"
ON public.organization_members FOR UPDATE
USING (public.is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can delete members in their org"
ON public.organization_members FOR DELETE
USING (public.is_org_admin(auth.uid(), organization_id));

-- RLS Policies for debug_sessions
CREATE POLICY "Users can view their debug sessions"
ON public.debug_sessions FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can manage their debug sessions"
ON public.debug_sessions FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their debug sessions"
ON public.debug_sessions FOR UPDATE
USING (user_id = auth.uid());

CREATE POLICY "Users can delete their debug sessions"
ON public.debug_sessions FOR DELETE
USING (user_id = auth.uid());

-- RLS Policies for global_configs
CREATE POLICY "Members can view org global config"
ON public.global_configs FOR SELECT
USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "Admins can update org global config"
ON public.global_configs FOR UPDATE
USING (public.is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can insert org global config"
ON public.global_configs FOR INSERT
WITH CHECK (public.is_org_admin(auth.uid(), organization_id));

-- Update existing table policies to be organization-scoped
DROP POLICY IF EXISTS "Anyone can read dataspace configs" ON public.dataspace_configs;
DROP POLICY IF EXISTS "Anyone can insert dataspace configs" ON public.dataspace_configs;
DROP POLICY IF EXISTS "Anyone can update dataspace configs" ON public.dataspace_configs;
DROP POLICY IF EXISTS "Anyone can delete dataspace configs" ON public.dataspace_configs;

CREATE POLICY "Members can read org dataspace configs"
ON public.dataspace_configs FOR SELECT
USING (organization_id IS NULL OR public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "Admins can insert org dataspace configs"
ON public.dataspace_configs FOR INSERT
WITH CHECK (public.is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can update org dataspace configs"
ON public.dataspace_configs FOR UPDATE
USING (public.is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can delete org dataspace configs"
ON public.dataspace_configs FOR DELETE
USING (public.is_org_admin(auth.uid(), organization_id));

-- Update dataspace_params policies
DROP POLICY IF EXISTS "Anyone can read dataspace params" ON public.dataspace_params;
DROP POLICY IF EXISTS "Anyone can insert dataspace params" ON public.dataspace_params;
DROP POLICY IF EXISTS "Anyone can update dataspace params" ON public.dataspace_params;
DROP POLICY IF EXISTS "Anyone can delete dataspace params" ON public.dataspace_params;

CREATE POLICY "Members can read org dataspace params"
ON public.dataspace_params FOR SELECT
USING (organization_id IS NULL OR public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "Admins can insert org dataspace params"
ON public.dataspace_params FOR INSERT
WITH CHECK (public.is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can update org dataspace params"
ON public.dataspace_params FOR UPDATE
USING (public.is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can delete org dataspace params"
ON public.dataspace_params FOR DELETE
USING (public.is_org_admin(auth.uid(), organization_id));

-- Update service_chains policies
DROP POLICY IF EXISTS "Anyone can read service chains" ON public.service_chains;
DROP POLICY IF EXISTS "Anyone can insert service chains" ON public.service_chains;
DROP POLICY IF EXISTS "Anyone can update service chains" ON public.service_chains;
DROP POLICY IF EXISTS "Anyone can delete service chains" ON public.service_chains;

CREATE POLICY "Members can read org service chains"
ON public.service_chains FOR SELECT
USING (organization_id IS NULL OR public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "Admins can insert org service chains"
ON public.service_chains FOR INSERT
WITH CHECK (public.is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can update org service chains"
ON public.service_chains FOR UPDATE
USING (public.is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can delete org service chains"
ON public.service_chains FOR DELETE
USING (public.is_org_admin(auth.uid(), organization_id));

-- Update pdc_execution_logs policies
DROP POLICY IF EXISTS "Anyone can read execution logs" ON public.pdc_execution_logs;
DROP POLICY IF EXISTS "Anyone can insert execution logs" ON public.pdc_execution_logs;

CREATE POLICY "Members can read org execution logs"
ON public.pdc_execution_logs FOR SELECT
USING (organization_id IS NULL OR public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "Members can insert org execution logs"
ON public.pdc_execution_logs FOR INSERT
WITH CHECK (organization_id IS NULL OR public.is_org_member(auth.uid(), organization_id));

-- Trigger to auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (user_id, email, full_name)
    VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Utility trigger function for updated_at columns
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- Add update triggers
CREATE TRIGGER update_organizations_updated_at
    BEFORE UPDATE ON public.organizations
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_global_configs_updated_at
    BEFORE UPDATE ON public.global_configs
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
