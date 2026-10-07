-- Per-organization envelope keys. Plaintext data keys exist only in trusted
-- function/worker memory; PostgreSQL stores keys wrapped by WORKFLOW_SECRETS_KEY.
CREATE TABLE public.workflow_organization_keys (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key_version integer NOT NULL CHECK (key_version > 0),
  wrapped_key_ciphertext text NOT NULL CHECK (length(wrapped_key_ciphertext) BETWEEN 40 AND 1000),
  status text NOT NULL CHECK (status IN ('active','retired')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  retired_at timestamptz,
  UNIQUE (organization_id,key_version)
);
CREATE UNIQUE INDEX workflow_organization_keys_one_active ON public.workflow_organization_keys(organization_id) WHERE status='active';
CREATE INDEX workflow_organization_keys_lookup ON public.workflow_organization_keys(organization_id,id);
ALTER TABLE public.workflow_organization_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workflow_organization_keys FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.workflow_organization_keys TO service_role;

CREATE TABLE public.workflow_encryption_delegations (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission text NOT NULL DEFAULT 'manage_workflow_encryption' CHECK (permission='manage_workflow_encryption'),
  delegated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (organization_id,user_id,permission)
);
CREATE INDEX workflow_encryption_delegations_active ON public.workflow_encryption_delegations(organization_id,user_id) WHERE revoked_at IS NULL;
ALTER TABLE public.workflow_encryption_delegations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workflow_encryption_delegations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.workflow_encryption_delegations TO service_role;

CREATE TABLE public.workflow_encryption_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('key_initialized','key_rotated','delegate_granted','delegate_revoked')),
  key_id uuid,
  subject_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX workflow_encryption_audit_events_org_time ON public.workflow_encryption_audit_events(organization_id,created_at DESC);
ALTER TABLE public.workflow_encryption_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workflow_encryption_audit_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.workflow_encryption_audit_events TO service_role;

CREATE OR REPLACE FUNCTION public.next_workflow_organization_key_version(p_organization_id uuid) RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce(max(key_version),0)+1 FROM public.workflow_organization_keys WHERE organization_id=p_organization_id
$$;

CREATE OR REPLACE FUNCTION public.activate_workflow_organization_key(
  p_organization_id uuid, p_key_id uuid, p_key_version integer,
  p_wrapped_key_ciphertext text, p_actor_user_id uuid, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE existing public.workflow_organization_keys; activated public.workflow_organization_keys;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text,482019));
  SELECT * INTO existing FROM public.workflow_organization_keys WHERE organization_id=p_organization_id AND status='active';
  IF p_reason='initialized' AND FOUND THEN RETURN to_jsonb(existing); END IF;
  IF p_key_version<>(SELECT coalesce(max(key_version),0)+1 FROM public.workflow_organization_keys WHERE organization_id=p_organization_id) THEN
    RAISE EXCEPTION 'Organization key version changed; retry rotation.' USING ERRCODE='40001';
  END IF;
  UPDATE public.workflow_organization_keys SET status='retired',retired_at=clock_timestamp()
    WHERE organization_id=p_organization_id AND status='active';
  INSERT INTO public.workflow_organization_keys(id,organization_id,key_version,wrapped_key_ciphertext,status,created_by)
    VALUES(p_key_id,p_organization_id,p_key_version,p_wrapped_key_ciphertext,'active',p_actor_user_id) RETURNING * INTO activated;
  INSERT INTO public.workflow_encryption_audit_events(organization_id,actor_user_id,event_type,key_id,metadata)
    VALUES(p_organization_id,p_actor_user_id,CASE WHEN p_reason='initialized' THEN 'key_initialized' ELSE 'key_rotated' END,p_key_id,jsonb_build_object('version',p_key_version));
  RETURN to_jsonb(activated);
END $$;

CREATE OR REPLACE FUNCTION public.set_workflow_encryption_delegation(
  p_organization_id uuid, p_subject_user_id uuid, p_actor_user_id uuid, p_enabled boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text,482020));
  IF p_enabled THEN
    INSERT INTO public.workflow_encryption_delegations(organization_id,user_id,permission,delegated_by,created_at,revoked_at,revoked_by)
      VALUES(p_organization_id,p_subject_user_id,'manage_workflow_encryption',p_actor_user_id,clock_timestamp(),NULL,NULL)
      ON CONFLICT(organization_id,user_id,permission) DO UPDATE SET delegated_by=excluded.delegated_by,created_at=excluded.created_at,revoked_at=NULL,revoked_by=NULL;
  ELSE
    UPDATE public.workflow_encryption_delegations SET revoked_at=clock_timestamp(),revoked_by=p_actor_user_id
      WHERE organization_id=p_organization_id AND user_id=p_subject_user_id AND permission='manage_workflow_encryption' AND revoked_at IS NULL;
  END IF;
  INSERT INTO public.workflow_encryption_audit_events(organization_id,actor_user_id,event_type,subject_user_id)
    VALUES(p_organization_id,p_actor_user_id,CASE WHEN p_enabled THEN 'delegate_granted' ELSE 'delegate_revoked' END,p_subject_user_id);
END $$;

REVOKE ALL ON FUNCTION public.next_workflow_organization_key_version(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.activate_workflow_organization_key(uuid,uuid,integer,text,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.set_workflow_encryption_delegation(uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.next_workflow_organization_key_version(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_workflow_organization_key(uuid,uuid,integer,text,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_workflow_encryption_delegation(uuid,uuid,uuid,boolean) TO service_role;

COMMENT ON TABLE public.workflow_organization_keys IS 'Versioned per-organization AES data keys wrapped by the deployment WORKFLOW_SECRETS_KEY; never contains plaintext keys.';
COMMENT ON TABLE public.workflow_encryption_delegations IS 'Narrow permission allowing an active organization member to inspect and rotate workflow encryption without receiving other admin privileges.';
