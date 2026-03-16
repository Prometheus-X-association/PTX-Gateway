
-- Add result URL configuration columns to service_chains table
ALTER TABLE public.service_chains
  ADD COLUMN IF NOT EXISTS result_url_source text DEFAULT 'contract',
  ADD COLUMN IF NOT EXISTS custom_result_url text,
  ADD COLUMN IF NOT EXISTS result_authorization text,
  ADD COLUMN IF NOT EXISTS result_query_params jsonb DEFAULT '[]'::jsonb;

-- Add comment for clarity
COMMENT ON COLUMN public.service_chains.result_url_source IS 'Source for result URL: contract (from last embedded resource representation.url), fallback (from PDC config), custom (manual URL)';
COMMENT ON COLUMN public.service_chains.custom_result_url IS 'Custom result URL when result_url_source = custom';
COMMENT ON COLUMN public.service_chains.result_authorization IS 'Authorization header for result fetching';
COMMENT ON COLUMN public.service_chains.result_query_params IS 'Query parameters for result URL as [{paramName, paramValue}]';
