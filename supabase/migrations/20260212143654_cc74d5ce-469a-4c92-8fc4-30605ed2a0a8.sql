
-- Fix dataspace_params RLS: Drop restrictive policies and recreate as permissive
DROP POLICY IF EXISTS "Members can read org dataspace params" ON public.dataspace_params;
DROP POLICY IF EXISTS "Admins can insert org dataspace params" ON public.dataspace_params;
DROP POLICY IF EXISTS "Admins can update org dataspace params" ON public.dataspace_params;
DROP POLICY IF EXISTS "Admins can delete org dataspace params" ON public.dataspace_params;
DROP POLICY IF EXISTS "Public can read visible dataspace params" ON public.dataspace_params;

CREATE POLICY "Members can read org dataspace params"
  ON public.dataspace_params FOR SELECT
  USING ((organization_id IS NULL) OR is_org_member(auth.uid(), organization_id));

CREATE POLICY "Public can read visible dataspace params"
  ON public.dataspace_params FOR SELECT
  USING (is_visible = true);

CREATE POLICY "Admins can insert org dataspace params"
  ON public.dataspace_params FOR INSERT
  WITH CHECK (is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can update org dataspace params"
  ON public.dataspace_params FOR UPDATE
  USING (is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can delete org dataspace params"
  ON public.dataspace_params FOR DELETE
  USING (is_org_admin(auth.uid(), organization_id));

-- Fix service_chains RLS: Drop restrictive policies and recreate as permissive
DROP POLICY IF EXISTS "Members can read org service chains" ON public.service_chains;
DROP POLICY IF EXISTS "Admins can insert org service chains" ON public.service_chains;
DROP POLICY IF EXISTS "Admins can update org service chains" ON public.service_chains;
DROP POLICY IF EXISTS "Admins can delete org service chains" ON public.service_chains;
DROP POLICY IF EXISTS "Public can read visible service chains" ON public.service_chains;

CREATE POLICY "Members can read org service chains"
  ON public.service_chains FOR SELECT
  USING ((organization_id IS NULL) OR is_org_member(auth.uid(), organization_id));

CREATE POLICY "Public can read visible service chains"
  ON public.service_chains FOR SELECT
  USING (is_visible = true);

CREATE POLICY "Admins can insert org service chains"
  ON public.service_chains FOR INSERT
  WITH CHECK (is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can update org service chains"
  ON public.service_chains FOR UPDATE
  USING (is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can delete org service chains"
  ON public.service_chains FOR DELETE
  USING (is_org_admin(auth.uid(), organization_id));

-- Fix dataspace_configs RLS too
DROP POLICY IF EXISTS "Members can read org dataspace configs" ON public.dataspace_configs;
DROP POLICY IF EXISTS "Admins can insert org dataspace configs" ON public.dataspace_configs;
DROP POLICY IF EXISTS "Admins can update org dataspace configs" ON public.dataspace_configs;
DROP POLICY IF EXISTS "Admins can delete org dataspace configs" ON public.dataspace_configs;
DROP POLICY IF EXISTS "Public can read active dataspace configs" ON public.dataspace_configs;

CREATE POLICY "Members can read org dataspace configs"
  ON public.dataspace_configs FOR SELECT
  USING ((organization_id IS NULL) OR is_org_member(auth.uid(), organization_id));

CREATE POLICY "Public can read active dataspace configs"
  ON public.dataspace_configs FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can insert org dataspace configs"
  ON public.dataspace_configs FOR INSERT
  WITH CHECK (is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can update org dataspace configs"
  ON public.dataspace_configs FOR UPDATE
  USING (is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can delete org dataspace configs"
  ON public.dataspace_configs FOR DELETE
  USING (is_org_admin(auth.uid(), organization_id));

-- Fix remaining tables with same issue
-- global_configs
DROP POLICY IF EXISTS "Members can view org global config" ON public.global_configs;
DROP POLICY IF EXISTS "Admins can update org global config" ON public.global_configs;
DROP POLICY IF EXISTS "Admins can insert org global config" ON public.global_configs;

CREATE POLICY "Members can view org global config"
  ON public.global_configs FOR SELECT
  USING (is_org_member(auth.uid(), organization_id));

CREATE POLICY "Admins can update org global config"
  ON public.global_configs FOR UPDATE
  USING (is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can insert org global config"
  ON public.global_configs FOR INSERT
  WITH CHECK (is_org_admin(auth.uid(), organization_id));

-- organization_members
DROP POLICY IF EXISTS "Users can view members in their org" ON public.organization_members;
DROP POLICY IF EXISTS "Admins can manage members in their org" ON public.organization_members;
DROP POLICY IF EXISTS "Admins can update members in their org" ON public.organization_members;
DROP POLICY IF EXISTS "Admins can delete members in their org" ON public.organization_members;

CREATE POLICY "Users can view members in their org"
  ON public.organization_members FOR SELECT
  USING (is_org_member(auth.uid(), organization_id));

CREATE POLICY "Admins can manage members in their org"
  ON public.organization_members FOR INSERT
  WITH CHECK (is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can update members in their org"
  ON public.organization_members FOR UPDATE
  USING (is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can delete members in their org"
  ON public.organization_members FOR DELETE
  USING (is_org_admin(auth.uid(), organization_id));

-- organizations
DROP POLICY IF EXISTS "Users can view their organizations" ON public.organizations;
DROP POLICY IF EXISTS "Admins can update their organization" ON public.organizations;
DROP POLICY IF EXISTS "No direct organization inserts" ON public.organizations;
DROP POLICY IF EXISTS "Public can read active organizations by slug" ON public.organizations;

CREATE POLICY "Users can view their organizations"
  ON public.organizations FOR SELECT
  USING (is_org_member(auth.uid(), id));

CREATE POLICY "Public can read active organizations by slug"
  ON public.organizations FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can update their organization"
  ON public.organizations FOR UPDATE
  USING (is_org_admin(auth.uid(), id));

CREATE POLICY "No direct organization inserts"
  ON public.organizations FOR INSERT
  WITH CHECK (false);

-- user_roles
DROP POLICY IF EXISTS "Users can view roles in their org" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage roles in their org" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can update roles in their org" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can delete roles in their org" ON public.user_roles;

CREATE POLICY "Users can view roles in their org"
  ON public.user_roles FOR SELECT
  USING (is_org_member(auth.uid(), organization_id));

CREATE POLICY "Admins can manage roles in their org"
  ON public.user_roles FOR INSERT
  WITH CHECK (is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can update roles in their org"
  ON public.user_roles FOR UPDATE
  USING (is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can delete roles in their org"
  ON public.user_roles FOR DELETE
  USING (is_org_admin(auth.uid(), organization_id));

-- debug_sessions
DROP POLICY IF EXISTS "Users can view their debug sessions" ON public.debug_sessions;
DROP POLICY IF EXISTS "Users can manage their debug sessions" ON public.debug_sessions;
DROP POLICY IF EXISTS "Users can update their debug sessions" ON public.debug_sessions;
DROP POLICY IF EXISTS "Users can delete their debug sessions" ON public.debug_sessions;

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

-- param_placeholders
DROP POLICY IF EXISTS "Members can read org placeholders" ON public.param_placeholders;
DROP POLICY IF EXISTS "Admins can insert org placeholders" ON public.param_placeholders;
DROP POLICY IF EXISTS "Admins can update org placeholders" ON public.param_placeholders;
DROP POLICY IF EXISTS "Admins can delete org placeholders" ON public.param_placeholders;

CREATE POLICY "Members can read org placeholders"
  ON public.param_placeholders FOR SELECT
  USING (is_org_member(auth.uid(), organization_id));

CREATE POLICY "Admins can insert org placeholders"
  ON public.param_placeholders FOR INSERT
  WITH CHECK (is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can update org placeholders"
  ON public.param_placeholders FOR UPDATE
  USING (is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can delete org placeholders"
  ON public.param_placeholders FOR DELETE
  USING (is_org_admin(auth.uid(), organization_id));

-- pdc_execution_logs
DROP POLICY IF EXISTS "Members can read org execution logs" ON public.pdc_execution_logs;
DROP POLICY IF EXISTS "Members can insert org execution logs" ON public.pdc_execution_logs;

CREATE POLICY "Members can read org execution logs"
  ON public.pdc_execution_logs FOR SELECT
  USING ((organization_id IS NULL) OR is_org_member(auth.uid(), organization_id));

CREATE POLICY "Members can insert org execution logs"
  ON public.pdc_execution_logs FOR INSERT
  WITH CHECK ((organization_id IS NULL) OR is_org_member(auth.uid(), organization_id));

-- profiles
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view org member profiles" ON public.profiles;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can view org member profiles"
  ON public.profiles FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM organization_members om1
    JOIN organization_members om2 ON om1.organization_id = om2.organization_id
    WHERE om1.user_id = auth.uid()
      AND om2.user_id = profiles.user_id
      AND om1.status = 'active'
      AND om2.status = 'active'
  ));

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (user_id = auth.uid());
