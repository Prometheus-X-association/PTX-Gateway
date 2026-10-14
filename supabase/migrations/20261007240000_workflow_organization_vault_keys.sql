-- Move organization workflow keys to Supabase Vault. Vault owns the project
-- root key; organization administrators initialize/rotate data keys without
-- an application-managed WORKFLOW_SECRETS_KEY.
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

ALTER TABLE public.workflow_organization_keys
  ADD COLUMN vault_secret_id uuid,
  ALTER COLUMN wrapped_key_ciphertext DROP NOT NULL,
  ADD CONSTRAINT workflow_organization_keys_material_check CHECK (
    (vault_secret_id IS NOT NULL AND wrapped_key_ciphertext IS NULL) OR
    (vault_secret_id IS NULL AND wrapped_key_ciphertext IS NOT NULL)
  );
CREATE UNIQUE INDEX workflow_organization_keys_vault_secret ON public.workflow_organization_keys(vault_secret_id) WHERE vault_secret_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.delete_workflow_organization_vault_secret() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,vault AS $$
BEGIN
  IF OLD.vault_secret_id IS NOT NULL THEN DELETE FROM vault.secrets WHERE id=OLD.vault_secret_id; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER delete_workflow_organization_vault_secret_before_key
  BEFORE DELETE ON public.workflow_organization_keys FOR EACH ROW EXECUTE FUNCTION public.delete_workflow_organization_vault_secret();
REVOKE ALL ON FUNCTION public.delete_workflow_organization_vault_secret() FROM PUBLIC,anon,authenticated;

-- This RPC is the only application path that releases plaintext organization
-- key material. It is service-role-only and never callable by a browser role.
CREATE OR REPLACE FUNCTION public.workflow_organization_key_material(
  p_organization_id uuid, p_key_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,vault AS $$
  SELECT jsonb_build_object(
    'id',k.id,
    'organization_id',k.organization_id,
    'key_version',k.key_version,
    'status',k.status,
    'activated_at',k.activated_at,
    'key_material',d.decrypted_secret,
    'wrapped_key_ciphertext',k.wrapped_key_ciphertext)
  FROM public.workflow_organization_keys k
  LEFT JOIN vault.decrypted_secrets d ON d.id=k.vault_secret_id
  WHERE k.organization_id=p_organization_id
    AND CASE WHEN p_key_id IS NULL THEN k.status='active' ELSE k.id=p_key_id END
  ORDER BY k.key_version DESC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.activate_workflow_organization_vault_key(
  p_organization_id uuid, p_actor_user_id uuid, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,vault,extensions AS $$
DECLARE existing public.workflow_organization_keys; activated public.workflow_organization_keys;
  next_version integer; secret_id uuid; generated_key text; new_key_id uuid:=gen_random_uuid();
BEGIN
  IF p_reason NOT IN ('initialized','rotated') THEN RAISE EXCEPTION 'Invalid key activation reason.' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text,482019));
  SELECT * INTO existing FROM public.workflow_organization_keys WHERE organization_id=p_organization_id AND status='active';
  IF p_reason='initialized' AND FOUND THEN RETURN to_jsonb(existing); END IF;
  SELECT coalesce(max(key_version),0)+1 INTO next_version FROM public.workflow_organization_keys WHERE organization_id=p_organization_id;
  generated_key:=encode(gen_random_bytes(32),'base64');
  secret_id:=vault.create_secret(generated_key,format('workflow-org-%s-v%s',p_organization_id,next_version),format('Workflow organization encryption key version %s',next_version));
  generated_key:=NULL;
  UPDATE public.workflow_organization_keys SET status='retired',retired_at=clock_timestamp()
    WHERE organization_id=p_organization_id AND status='active';
  INSERT INTO public.workflow_organization_keys(id,organization_id,key_version,wrapped_key_ciphertext,vault_secret_id,status,created_by)
    VALUES(new_key_id,p_organization_id,next_version,NULL,secret_id,'active',p_actor_user_id) RETURNING * INTO activated;
  INSERT INTO public.workflow_encryption_audit_events(organization_id,actor_user_id,event_type,key_id,metadata)
    VALUES(p_organization_id,p_actor_user_id,CASE WHEN p_reason='initialized' THEN 'key_initialized' ELSE 'key_rotated' END,new_key_id,jsonb_build_object('version',next_version,'storage','supabase_vault'));
  RETURN to_jsonb(activated);
END $$;

REVOKE ALL ON FUNCTION public.workflow_organization_key_material(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.activate_workflow_organization_vault_key(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_organization_key_material(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_workflow_organization_vault_key(uuid,uuid,text) TO service_role;

COMMENT ON COLUMN public.workflow_organization_keys.vault_secret_id IS 'Supabase Vault secret containing this organization key; decrypted only through the service-role key-material RPC.';
COMMENT ON TABLE public.workflow_organization_keys IS 'Versioned per-organization AES data keys stored in Supabase Vault; legacy wrapped-key rows remain readable during migration.';
