
-- Drop old non-org-scoped unique constraints
ALTER TABLE public.dataspace_params DROP CONSTRAINT IF EXISTS dataspace_params_resource_contract_unique;
ALTER TABLE public.dataspace_params DROP CONSTRAINT IF EXISTS dataspace_params_config_id_resource_url_contract_url_key;

-- Recreate with organization_id scope
ALTER TABLE public.dataspace_params ADD CONSTRAINT dataspace_params_org_resource_contract_unique 
  UNIQUE (organization_id, resource_url, contract_url);

-- Drop old non-org-scoped unique constraints for service_chains
ALTER TABLE public.service_chains DROP CONSTRAINT IF EXISTS service_chains_catalog_contract_unique;
ALTER TABLE public.service_chains DROP CONSTRAINT IF EXISTS service_chains_config_id_catalog_id_contract_url_key;

-- Recreate with organization_id scope
ALTER TABLE public.service_chains ADD CONSTRAINT service_chains_org_catalog_contract_unique 
  UNIQUE (organization_id, catalog_id, contract_url);
