-- Add fields for result URL configuration
-- 1. Add use_fallback_result_url to dataspace_params for API data resources
ALTER TABLE public.dataspace_params 
ADD COLUMN IF NOT EXISTS use_fallback_result_url boolean DEFAULT false;

-- 2. Add result_authorization to dataspace_params for individual resource authorization
ALTER TABLE public.dataspace_params 
ADD COLUMN IF NOT EXISTS result_authorization text;

-- 3. Add fallback_result_authorization to dataspace_configs for fallback URL authorization
ALTER TABLE public.dataspace_configs 
ADD COLUMN IF NOT EXISTS fallback_result_authorization text;

-- Add comments for documentation
COMMENT ON COLUMN public.dataspace_params.use_fallback_result_url IS 'When true, use the fallback_result_url from PDC config instead of api_response_representation.url';
COMMENT ON COLUMN public.dataspace_params.result_authorization IS 'Authorization header value for result fetching (e.g., Bearer token)';
COMMENT ON COLUMN public.dataspace_configs.fallback_result_authorization IS 'Authorization header value for fallback result URL fetching';