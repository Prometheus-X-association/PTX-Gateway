-- Drop the overly permissive policy that exposes all profiles publicly
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;

-- Create a new policy: Users can only view their own profile
CREATE POLICY "Users can view own profile"
ON public.profiles
FOR SELECT
USING (user_id = auth.uid());

-- Create a policy: Users can view profiles of members in their organization
CREATE POLICY "Users can view org member profiles"
ON public.profiles
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members om1
    JOIN public.organization_members om2 ON om1.organization_id = om2.organization_id
    WHERE om1.user_id = auth.uid()
      AND om2.user_id = profiles.user_id
      AND om1.status = 'active'
      AND om2.status = 'active'
  )
);