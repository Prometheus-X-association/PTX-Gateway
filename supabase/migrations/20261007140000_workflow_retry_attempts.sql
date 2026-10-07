ALTER TABLE public.workflow_run_steps ADD COLUMN attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count BETWEEN 1 AND 10);
