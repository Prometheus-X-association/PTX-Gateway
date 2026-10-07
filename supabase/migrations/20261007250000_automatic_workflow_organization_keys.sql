-- Workflow encryption is infrastructure, not an organization-admin setting.
-- Provision a Vault-backed data key in the same transaction as every new
-- organization and repair organizations created before this migration.
CREATE OR REPLACE FUNCTION public.provision_workflow_organization_key()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,vault,extensions
AS $$
BEGIN
  PERFORM public.activate_workflow_organization_vault_key(NEW.id,NULL,'initialized');
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS provision_workflow_organization_key_after_insert ON public.organizations;
CREATE TRIGGER provision_workflow_organization_key_after_insert
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.provision_workflow_organization_key();

REVOKE ALL ON FUNCTION public.provision_workflow_organization_key() FROM PUBLIC,anon,authenticated;

-- Idempotent backfill. The activation function serializes per organization and
-- returns the existing active key if another process provisioned it first.
DO $$
DECLARE organization_record record;
BEGIN
  FOR organization_record IN
    SELECT org.id
    FROM public.organizations AS org
    WHERE NOT EXISTS (
      SELECT 1 FROM public.workflow_organization_keys AS workflow_key
      WHERE workflow_key.organization_id=org.id AND workflow_key.status='active'
    )
  LOOP
    PERFORM public.activate_workflow_organization_vault_key(organization_record.id,NULL,'initialized');
  END LOOP;
END
$$;

COMMENT ON FUNCTION public.provision_workflow_organization_key() IS
  'Automatically provisions the hidden Vault-backed workflow data key when an organization is created.';
