-- Add result URL source options to dataspace_params
-- Options: 'contract' (default - from api_response_representation), 'fallback' (from PDC config), 'custom' (user-defined)
ALTER TABLE public.dataspace_params 
ADD COLUMN IF NOT EXISTS result_url_source text DEFAULT 'contract';

-- Add custom result URL field
ALTER TABLE public.dataspace_params 
ADD COLUMN IF NOT EXISTS custom_result_url text;

-- Migrate existing data: if use_fallback_result_url is true, set source to 'fallback'
UPDATE public.dataspace_params 
SET result_url_source = 'fallback' 
WHERE use_fallback_result_url = true;

-- Comment for documentation
COMMENT ON COLUMN public.dataspace_params.result_url_source IS 'Source for result URL: contract (default), fallback (from PDC config), or custom';
COMMENT ON COLUMN public.dataspace_params.custom_result_url IS 'Custom result URL when result_url_source is custom';