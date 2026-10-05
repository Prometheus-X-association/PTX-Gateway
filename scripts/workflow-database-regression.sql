-- Execute after the migration against a disposable database.
BEGIN;
INSERT INTO public.organizations(id) VALUES ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');
INSERT INTO public.workflow_webhooks(organization_id,workflow_id,name,secret_ciphertext)
VALUES ('00000000-0000-4000-8000-000000000001','shared','Orders','encrypted'), ('00000000-0000-4000-8000-000000000001','shared','Payments','encrypted');
INSERT INTO public.workflow_runs(organization_id,workflow_id,workflow_name,caller_id,trigger_source,request_hash,snapshot,input,max_concurrent_runs)
SELECT '00000000-0000-4000-8000-000000000001','shared','Shared workflow','user:' || number,'api','hash','{}','{}',2 FROM generate_series(1,4) number;
INSERT INTO public.workflow_runs(organization_id,workflow_id,workflow_name,caller_id,trigger_source,request_hash,snapshot,input,max_concurrent_runs)
VALUES ('00000000-0000-4000-8000-000000000002','shared','Other organization','user:other','api','hash','{}','{}',2);
DO $$
DECLARE first_run public.workflow_runs; second_run public.workflow_runs; third_run public.workflow_runs;
BEGIN
  SELECT * INTO first_run FROM public.claim_workflow_run(2);
  SELECT * INTO second_run FROM public.claim_workflow_run(2);
  SELECT * INTO third_run FROM public.claim_workflow_run(2);
  IF first_run.id = second_run.id THEN RAISE EXCEPTION 'Workers claimed the same run'; END IF;
  IF third_run.organization_id <> '00000000-0000-4000-8000-000000000002' THEN RAISE EXCEPTION 'Organization/workflow concurrency cap was not enforced'; END IF;
  IF EXISTS (SELECT 1 FROM public.claim_workflow_run(2)) THEN RAISE EXCEPTION 'Claim exceeded concurrency limit'; END IF;
  IF has_table_privilege('authenticated','public.workflow_runs','SELECT') OR has_table_privilege('anon','public.workflow_webhooks','SELECT') THEN RAISE EXCEPTION 'Private execution data is publicly accessible'; END IF;
  IF has_function_privilege('authenticated','public.claim_workflow_run(integer)','EXECUTE') THEN RAISE EXCEPTION 'User can claim worker jobs'; END IF;
  BEGIN
    INSERT INTO public.workflow_run_steps(organization_id,run_id,sequence,node_id,node_name,node_type,status)
      VALUES ('00000000-0000-4000-8000-000000000002',first_run.id,1,'node','Node','agent','running');
    RAISE EXCEPTION 'Cross-organization step insert was allowed';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  INSERT INTO public.workflow_run_steps(organization_id,run_id,sequence,node_id,node_name,node_type,status)
    VALUES (first_run.organization_id,first_run.id,1,'api','API','api','running');
  UPDATE public.workflow_runs SET lease_expires_at = now() - interval '1 minute', current_node_id = 'api' WHERE id = first_run.id;
  PERFORM public.claim_workflow_run(2);
  IF NOT EXISTS (SELECT 1 FROM public.workflow_runs WHERE id = first_run.id AND status = 'failed' AND failed_node_id = 'api') THEN RAISE EXCEPTION 'Expired worker did not produce a failure trace'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workflow_run_steps WHERE run_id = first_run.id AND status = 'failed') THEN RAISE EXCEPTION 'Interrupted step was not marked failed'; END IF;
  UPDATE public.workflow_runs SET status = 'waiting_for_input' WHERE id = second_run.id;
  UPDATE public.workflow_runs SET status = 'queued', resume_answer = 'yes' WHERE id = second_run.id AND status = 'waiting_for_input';
  IF NOT FOUND THEN RAISE EXCEPTION 'First answer was not accepted'; END IF;
  UPDATE public.workflow_runs SET status = 'queued', resume_answer = 'no' WHERE id = second_run.id AND status = 'waiting_for_input';
  IF FOUND THEN RAISE EXCEPTION 'Duplicate resume was accepted'; END IF;
END $$;
ROLLBACK;
