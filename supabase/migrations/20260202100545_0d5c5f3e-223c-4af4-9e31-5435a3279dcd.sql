-- Add upload configuration columns for document upload resources
ALTER TABLE public.dataspace_params 
ADD COLUMN upload_url text,
ADD COLUMN upload_authorization text;

-- Add comment explaining the purpose
COMMENT ON COLUMN public.dataspace_params.upload_url IS 'Target URL for file uploads when visualization_type is upload_document';
COMMENT ON COLUMN public.dataspace_params.upload_authorization IS 'Authorization header value for file upload requests';