ALTER TABLE public.workflow_run_steps
  ADD COLUMN state_read_keys text[] NOT NULL DEFAULT ARRAY[]::text[];

-- Execution state is deliberately temporary. Terminal transitions clear the
-- ciphertext and cascade-delete artifacts; metadata-only state events remain.
CREATE FUNCTION public.purge_terminal_workflow_state() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status IN ('succeeded','failed','cancelled','timed_out','incomplete')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.run_state_ciphertext := NULL;
    DELETE FROM public.workflow_run_artifacts WHERE run_id=NEW.id AND organization_id=NEW.organization_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workflow_purge_terminal_state BEFORE UPDATE OF status ON public.workflow_runs
FOR EACH ROW EXECUTE FUNCTION public.purge_terminal_workflow_state();
REVOKE ALL ON FUNCTION public.purge_terminal_workflow_state() FROM PUBLIC, anon, authenticated;
