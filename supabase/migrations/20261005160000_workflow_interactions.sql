-- Durable waiting deadlines, interaction links and an at-least-once notification outbox.
ALTER TABLE public.workflow_runs
  ADD COLUMN interaction_expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  ADD COLUMN waiting_version uuid,
  ADD COLUMN waiting_expires_at timestamptz,
  ADD COLUMN next_reminder_at timestamptz,
  ADD COLUMN reminder_interval_seconds integer,
  ADD COLUMN reminder_limit integer NOT NULL DEFAULT 0,
  ADD COLUMN reminder_count integer NOT NULL DEFAULT 0;
CREATE INDEX workflow_runs_waiting_deadlines ON public.workflow_runs(waiting_expires_at) WHERE status = 'waiting_for_input';
CREATE TABLE public.workflow_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  run_id uuid NOT NULL,
  event_key text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('question','reminder','completed')),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivering','delivered','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (run_id, organization_id) REFERENCES public.workflow_runs(id, organization_id) ON DELETE CASCADE,
  UNIQUE(run_id, event_key)
);
CREATE INDEX workflow_notifications_pending ON public.workflow_notifications(available_at) WHERE status IN ('pending','delivering');
ALTER TABLE public.workflow_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workflow_notifications FROM anon, authenticated;
GRANT ALL ON public.workflow_notifications TO service_role;

CREATE FUNCTION public.prepare_workflow_wait() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'waiting_for_input' AND OLD.status <> 'waiting_for_input' THEN
    NEW.waiting_version := gen_random_uuid();
    NEW.waiting_expires_at := least(clock_timestamp() + make_interval(secs => greatest(60, least(2592000, coalesce((NEW.waiting->'policy'->>'responseTimeoutSeconds')::integer,172800)))), NEW.interaction_expires_at);
    NEW.reminder_interval_seconds := greatest(60, least(2592000, coalesce((NEW.waiting->'policy'->>'reminderIntervalSeconds')::integer,43200)));
    NEW.reminder_limit := greatest(0, least(20, coalesce((NEW.waiting->'policy'->>'maxReminders')::integer,3)));
    NEW.reminder_count := 0;
    NEW.next_reminder_at := clock_timestamp() + make_interval(secs => NEW.reminder_interval_seconds);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workflow_prepare_wait BEFORE UPDATE ON public.workflow_runs FOR EACH ROW EXECUTE FUNCTION public.prepare_workflow_wait();

CREATE FUNCTION public.enqueue_workflow_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'waiting_for_input' AND OLD.status <> 'waiting_for_input' THEN
    INSERT INTO public.workflow_notifications(organization_id,run_id,event_key,event_type,payload)
    VALUES (NEW.organization_id,NEW.id,NEW.waiting_version::text || ':question','question',
      jsonb_build_object('nodeId',NEW.waiting->>'nodeId','question',NEW.waiting->>'question','inputType',NEW.waiting->>'inputType','options',NEW.waiting->'options','waitingVersion',NEW.waiting_version,'expiresAt',NEW.waiting_expires_at));
  ELSIF NEW.status IN ('succeeded','failed','cancelled','timed_out','incomplete') AND OLD.status NOT IN ('succeeded','failed','cancelled','timed_out','incomplete') THEN
    INSERT INTO public.workflow_notifications(organization_id,run_id,event_key,event_type,payload)
    VALUES (NEW.organization_id,NEW.id,'completed','completed',jsonb_build_object('status',NEW.status,'output',NEW.output,'stopReason',NEW.stop_reason,'failedNodeId',NEW.failed_node_id)) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workflow_enqueue_event AFTER UPDATE ON public.workflow_runs FOR EACH ROW EXECUTE FUNCTION public.enqueue_workflow_event();

-- Use a row lock and the database clock: answer vs expiration has exactly one winner.
CREATE FUNCTION public.resume_workflow_run(p_run_id uuid,p_organization_id uuid,p_node_id text,p_waiting_version uuid,p_answer text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.workflow_runs;
BEGIN
  SELECT * INTO r FROM public.workflow_runs WHERE id=p_run_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'waiting_for_input' OR r.waiting->>'nodeId' <> p_node_id OR r.waiting_version IS DISTINCT FROM p_waiting_version THEN RETURN false; END IF;
  IF r.waiting_expires_at <= clock_timestamp() THEN
    UPDATE public.workflow_runs SET status='timed_out',failed_node_id=r.waiting->>'nodeId',stop_reason='Response deadline expired without an answer.',finished_at=clock_timestamp(),updated_at=clock_timestamp(),next_reminder_at=NULL WHERE id=r.id;
    UPDATE public.workflow_run_steps SET status='timed_out',error='Response deadline expired without an answer.',finished_at=clock_timestamp() WHERE run_id=r.id AND status='waiting';
    RETURN false;
  END IF;
  IF p_answer IS NULL OR length(btrim(p_answer))=0 OR length(p_answer)>100000 THEN RETURN false; END IF;
  UPDATE public.workflow_runs SET status='queued',resume_answer=p_answer,next_reminder_at=NULL,updated_at=clock_timestamp() WHERE id=r.id;
  RETURN true;
END $$;

CREATE FUNCTION public.maintain_workflow_interactions() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.workflow_runs;
BEGIN
  FOR r IN SELECT * FROM public.workflow_runs WHERE status='waiting_for_input' AND (waiting_expires_at<=clock_timestamp() OR next_reminder_at<=clock_timestamp()) FOR UPDATE SKIP LOCKED LOOP
    IF r.waiting_expires_at <= clock_timestamp() THEN
      UPDATE public.workflow_runs SET status='timed_out',failed_node_id=r.waiting->>'nodeId',stop_reason='Response deadline expired without an answer.',finished_at=clock_timestamp(),updated_at=clock_timestamp(),next_reminder_at=NULL WHERE id=r.id;
      UPDATE public.workflow_run_steps SET status='timed_out',error='Response deadline expired without an answer.',finished_at=clock_timestamp() WHERE run_id=r.id AND status='waiting';
    ELSIF r.reminder_count < r.reminder_limit THEN
      INSERT INTO public.workflow_notifications(organization_id,run_id,event_key,event_type,payload)
      VALUES (r.organization_id,r.id,r.waiting_version::text || ':reminder:' || (r.reminder_count+1),'reminder',jsonb_build_object('nodeId',r.waiting->>'nodeId','question',r.waiting->>'question','inputType',r.waiting->>'inputType','options',r.waiting->'options','waitingVersion',r.waiting_version,'expiresAt',r.waiting_expires_at,'reminderNumber',r.reminder_count+1)) ON CONFLICT DO NOTHING;
      UPDATE public.workflow_runs SET reminder_count=reminder_count+1,next_reminder_at=CASE WHEN reminder_count+1<reminder_limit THEN clock_timestamp()+make_interval(secs=>reminder_interval_seconds) ELSE NULL END WHERE id=r.id;
    ELSE
      UPDATE public.workflow_runs SET next_reminder_at=NULL WHERE id=r.id;
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION public.claim_workflow_notification() RETURNS SETOF public.workflow_notifications LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE candidate uuid;
BEGIN
  SELECT id INTO candidate FROM public.workflow_notifications WHERE (status='pending' AND available_at<=clock_timestamp()) OR (status='delivering' AND lease_expires_at<clock_timestamp()) ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1;
  RETURN QUERY UPDATE public.workflow_notifications SET status='delivering',attempts=attempts+1,lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '60 seconds' WHERE id=candidate RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.prepare_workflow_wait(), public.enqueue_workflow_event(), public.resume_workflow_run(uuid,uuid,text,uuid,text), public.maintain_workflow_interactions(), public.claim_workflow_notification() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resume_workflow_run(uuid,uuid,text,uuid,text), public.maintain_workflow_interactions(), public.claim_workflow_notification() TO service_role;

-- Existing paused runs acquire a finite response window when this migration is applied.
UPDATE public.workflow_runs SET waiting_version=gen_random_uuid(),waiting_expires_at=least(now()+interval '48 hours',interaction_expires_at),reminder_interval_seconds=43200,reminder_limit=3,next_reminder_at=now()+interval '12 hours' WHERE status='waiting_for_input';

INSERT INTO public.workflow_notifications(organization_id,run_id,event_key,event_type,payload)
SELECT organization_id,id,waiting_version::text || ':question','question',jsonb_build_object('nodeId',waiting->>'nodeId','question',waiting->>'question','inputType',waiting->>'inputType','options',waiting->'options','waitingVersion',waiting_version,'expiresAt',waiting_expires_at)
FROM public.workflow_runs WHERE status='waiting_for_input' ON CONFLICT DO NOTHING;
