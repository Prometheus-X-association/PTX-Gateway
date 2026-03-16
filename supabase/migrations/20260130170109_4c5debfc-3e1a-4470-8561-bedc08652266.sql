-- Allow public read access to active organizations (for landing page org search)
CREATE POLICY "Public can read active organizations by slug"
ON public.organizations
FOR SELECT
USING (is_active = true);