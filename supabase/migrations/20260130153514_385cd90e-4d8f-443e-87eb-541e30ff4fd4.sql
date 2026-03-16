-- Add public read policy for visible resources (allowing non-logged-in users to see visible data)
CREATE POLICY "Public can read visible dataspace params"
ON public.dataspace_params 
FOR SELECT
USING (is_visible = true);

-- Add public read policy for visible service chains
CREATE POLICY "Public can read visible service chains"
ON public.service_chains 
FOR SELECT
USING (is_visible = true);

-- Add public read policy for visible software resources from dataspace_configs
CREATE POLICY "Public can read active dataspace configs"
ON public.dataspace_configs 
FOR SELECT
USING (is_active = true);