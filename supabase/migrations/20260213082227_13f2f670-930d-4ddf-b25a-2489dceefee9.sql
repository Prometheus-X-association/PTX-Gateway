
-- Add export_api_configs jsonb column to dataspace_configs for admin-managed export endpoints
ALTER TABLE public.dataspace_configs
ADD COLUMN export_api_configs jsonb DEFAULT '[]'::jsonb;

-- Column stores array of objects: [{ name, url, authorization, params: [{key, value}], body_template }]
COMMENT ON COLUMN public.dataspace_configs.export_api_configs IS 'Admin-configured API export endpoints available to users on the results page';
