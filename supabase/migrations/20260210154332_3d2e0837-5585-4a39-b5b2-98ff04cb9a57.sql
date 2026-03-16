
-- Add result_query_params column to dataspace_params table for data resource result URL query parameters
ALTER TABLE public.dataspace_params
  ADD COLUMN IF NOT EXISTS result_query_params jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.dataspace_params.result_query_params IS 'Query parameters for result URL as [{paramName, paramValue}], supports placeholders like #genSessionId';
