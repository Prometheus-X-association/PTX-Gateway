-- Add embedded_resources column to service_chains table
-- This stores extracted resource information for each service in the chain
-- Each service in the chain can reference a software or data resource with its own parameters

ALTER TABLE public.service_chains
ADD COLUMN IF NOT EXISTS embedded_resources jsonb DEFAULT '[]'::jsonb;

-- Add a comment explaining the structure
COMMENT ON COLUMN public.service_chains.embedded_resources IS 'Array of extracted resource details for each service in the chain. Each entry contains: service_index, resource_type (software/data), resource_url, resource_name, resource_description, provider, parameters, api_response_representation, visualization_type, upload_url, upload_authorization, result_url_source, custom_result_url, result_authorization';