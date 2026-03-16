-- Add optional LLM prompt context fields for software resources and service chains.
ALTER TABLE public.dataspace_params
  ADD COLUMN IF NOT EXISTS llm_context text;

ALTER TABLE public.service_chains
  ADD COLUMN IF NOT EXISTS llm_context text;

COMMENT ON COLUMN public.dataspace_params.llm_context IS
'Optional context text used to enrich result-page LLM prompt for this resource (mainly software resources).';

COMMENT ON COLUMN public.service_chains.llm_context IS
'Optional context text used to enrich result-page LLM prompt for this service chain.';
