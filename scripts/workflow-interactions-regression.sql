-- Run after all workflow migrations in a disposable database.
BEGIN;
INSERT INTO public.organizations(id) VALUES ('00000000-0000-4000-8000-000000000011');
INSERT INTO public.workflow_runs(organization_id,workflow_id,workflow_name,caller_id,trigger_source,request_hash,snapshot,input)
VALUES ('00000000-0000-4000-8000-000000000011','approval','Approval','test','api','hash','{}','{}');
DO $$
DECLARE r public.workflow_runs; version uuid; job public.workflow_notifications; deadline timestamptz;
BEGIN
  SELECT * INTO r FROM public.workflow_runs WHERE workflow_id='approval';
  UPDATE public.workflow_runs SET status='running' WHERE id=r.id;
  UPDATE public.workflow_runs SET status='waiting_for_input',waiting='{"nodeId":"ask","question":"Approve?","inputType":"yes_no","policy":{"responseTimeoutSeconds":3600,"reminderIntervalSeconds":60,"maxReminders":2}}' WHERE id=r.id RETURNING * INTO r;
  version := r.waiting_version; deadline := r.waiting_expires_at;
  IF version IS NULL OR deadline <= now() THEN RAISE EXCEPTION 'Waiting policy not initialized'; END IF;
  IF (SELECT count(*) FROM public.workflow_notifications WHERE run_id=r.id AND event_type='question')<>1 THEN RAISE EXCEPTION 'Question notification missing'; END IF;
  IF has_table_privilege('authenticated','public.workflow_notifications','SELECT') OR has_function_privilege('authenticated','public.resume_workflow_run(uuid,uuid,text,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'Interaction service data/functions exposed'; END IF;
  IF public.resume_workflow_run(r.id,'00000000-0000-4000-8000-000000000012','ask',version,'yes') THEN RAISE EXCEPTION 'Cross-org resume allowed'; END IF;
  IF public.resume_workflow_run(r.id,r.organization_id,'ask',gen_random_uuid(),'yes') THEN RAISE EXCEPTION 'Old question version resumed'; END IF;
  UPDATE public.workflow_runs SET next_reminder_at=now()-interval '1 second' WHERE id=r.id;
  PERFORM public.maintain_workflow_interactions();
  UPDATE public.workflow_runs SET next_reminder_at=now()-interval '1 second' WHERE id=r.id;
  PERFORM public.maintain_workflow_interactions();
  UPDATE public.workflow_runs SET next_reminder_at=now()-interval '1 second' WHERE id=r.id;
  PERFORM public.maintain_workflow_interactions();
  IF (SELECT count(*) FROM public.workflow_notifications WHERE run_id=r.id AND event_type='reminder')<>2 THEN RAISE EXCEPTION 'Reminder limit not enforced'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workflow_runs WHERE id=r.id AND status='waiting_for_input' AND waiting_expires_at=deadline AND reminder_count=2 AND next_reminder_at IS NULL) THEN RAISE EXCEPTION 'Reminders changed timeout or prematurely stopped run'; END IF;
  SELECT * INTO job FROM public.claim_workflow_notification();
  IF job.id IS NULL OR job.attempts<>1 THEN RAISE EXCEPTION 'Notification not claimed'; END IF;
  IF EXISTS (SELECT 1 FROM public.claim_workflow_notification() WHERE id=job.id) THEN RAISE EXCEPTION 'Duplicate claim'; END IF;
  UPDATE public.workflow_notifications SET lease_expires_at=now()-interval '1 second',available_at=now()-interval '1 hour' WHERE id=job.id;
  IF NOT EXISTS (SELECT 1 FROM public.claim_workflow_notification() WHERE id=job.id AND attempts=2) THEN RAISE EXCEPTION 'Lost notification lease was not recovered'; END IF;
  IF NOT public.resume_workflow_run(r.id,r.organization_id,'ask',version,'yes') THEN RAISE EXCEPTION 'Valid answer rejected'; END IF;
  IF public.resume_workflow_run(r.id,r.organization_id,'ask',version,'no') THEN RAISE EXCEPTION 'Duplicate answer accepted'; END IF;
  UPDATE public.workflow_runs SET status='running' WHERE id=r.id;
  UPDATE public.workflow_runs SET status='waiting_for_input' WHERE id=r.id RETURNING * INTO r;
  IF r.waiting_version=version THEN RAISE EXCEPTION 'New question reused old version'; END IF;
  INSERT INTO public.workflow_run_steps(organization_id,run_id,sequence,node_id,node_name,node_type,status) VALUES (r.organization_id,r.id,1,'ask','Approval','user_input','waiting');
  UPDATE public.workflow_runs SET waiting_expires_at=now()-interval '1 second' WHERE id=r.id;
  IF public.resume_workflow_run(r.id,r.organization_id,'ask',r.waiting_version,'late') THEN RAISE EXCEPTION 'Late answer accepted'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workflow_runs WHERE id=r.id AND status='timed_out' AND failed_node_id='ask') THEN RAISE EXCEPTION 'Expired question not finalized'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workflow_run_steps WHERE run_id=r.id AND status='timed_out') THEN RAISE EXCEPTION 'Timeout node trace missing'; END IF;
  IF (SELECT count(*) FROM public.workflow_notifications WHERE run_id=r.id AND event_type='completed')<>1 THEN RAISE EXCEPTION 'Timeout completion callback missing'; END IF;
  PERFORM public.maintain_workflow_interactions();
  IF (SELECT count(*) FROM public.workflow_notifications WHERE run_id=r.id AND event_type='completed')<>1 THEN RAISE EXCEPTION 'Duplicate terminal callback'; END IF;
END $$;
-- Expiration runs without any resume request and does not enqueue a late reminder.
INSERT INTO public.workflow_runs(organization_id,workflow_id,workflow_name,caller_id,trigger_source,request_hash,snapshot,input)
VALUES ('00000000-0000-4000-8000-000000000011','silent','Silent','test','api','hash','{}','{}');
UPDATE public.workflow_runs SET status='running' WHERE workflow_id='silent';
UPDATE public.workflow_runs SET status='waiting_for_input',waiting='{"nodeId":"ask","question":"Reply?"}' WHERE workflow_id='silent';
UPDATE public.workflow_runs SET waiting_expires_at=now()-interval '1 second',next_reminder_at=now()-interval '1 second' WHERE workflow_id='silent';
SELECT public.maintain_workflow_interactions();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.workflow_runs WHERE workflow_id='silent' AND status='timed_out') THEN RAISE EXCEPTION 'Unanswered run did not expire automatically'; END IF;
  IF EXISTS (SELECT 1 FROM public.workflow_notifications n JOIN public.workflow_runs r ON r.id=n.run_id WHERE r.workflow_id='silent' AND n.event_type='reminder') THEN RAISE EXCEPTION 'Reminder sent after expiration'; END IF;
END $$;
ROLLBACK;
