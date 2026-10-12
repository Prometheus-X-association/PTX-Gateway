-- Auditable execution usage and cost valuation. Usage facts and published
-- policy versions are immutable; later corrections create new valuations.

CREATE TABLE public.operation_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  execution_kind text NOT NULL CHECK (execution_kind IN ('workflow','direct_agent')),
  execution_mode text NOT NULL CHECK (execution_mode IN ('browser','backend')),
  execution_source text NOT NULL CHECK (execution_source IN ('result_chat','dashboard','api','webhook','builder_test')),
  workflow_run_id uuid REFERENCES public.workflow_runs(id) ON DELETE SET NULL,
  workflow_id text,
  workflow_revision integer,
  agent_id text,
  actor_user_id uuid,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','waiting','succeeded','failed','cancelled','timed_out','incomplete')),
  trace_id text NOT NULL DEFAULT gen_random_uuid()::text,
  metadata jsonb NOT NULL DEFAULT '{}',
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workflow_run_id)
);

CREATE TABLE public.operation_execution_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  execution_id uuid NOT NULL REFERENCES public.operation_executions(id) ON DELETE CASCADE,
  workflow_step_id uuid REFERENCES public.workflow_run_steps(id) ON DELETE SET NULL,
  node_id text,
  node_type text,
  node_name text,
  agent_id text,
  agent_kind text CHECK (agent_kind IS NULL OR agent_kind IN ('saved','inline')),
  sequence integer NOT NULL DEFAULT 1,
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  operation_id text,
  status text NOT NULL CHECK (status IN ('running','succeeded','failed','waiting','cancelled','timed_out')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms >= 0),
  metadata jsonb NOT NULL DEFAULT '{}',
  UNIQUE (execution_id, sequence, attempt)
);

CREATE TABLE public.cost_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  policy_kind text NOT NULL CHECK (policy_kind IN ('token','execution','quantity','duration','tiered','subscription','composite')),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  archived_at timestamptz,
  UNIQUE (organization_id, name)
);

CREATE TABLE public.cost_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES public.cost_policies(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','scheduled','active','retired','rejected')),
  definition jsonb NOT NULL,
  formula_ast jsonb NOT NULL,
  engine_version integer NOT NULL DEFAULT 1,
  effective_from timestamptz,
  effective_until timestamptz,
  change_reason text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  approved_by uuid,
  approved_at timestamptz,
  published_by uuid,
  published_at timestamptz,
  content_hash text NOT NULL,
  UNIQUE (policy_id, version_number),
  CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until > effective_from)
);

CREATE TABLE public.cost_policy_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES public.cost_policies(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('organization','llm_provider','llm_model','mcp_server','mcp_tool','workflow','workflow_node','api_node','agent')),
  target_id text NOT NULL,
  workflow_id text,
  node_id text,
  precedence integer NOT NULL DEFAULT 0,
  effective_from timestamptz NOT NULL DEFAULT clock_timestamp(),
  effective_until timestamptz,
  retired_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE TABLE public.cost_policy_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  policy_id uuid REFERENCES public.cost_policies(id) ON DELETE SET NULL,
  policy_version_id uuid REFERENCES public.cost_policy_versions(id) ON DELETE SET NULL,
  action text NOT NULL,
  actor_user_id uuid,
  reason text NOT NULL DEFAULT '',
  before_value jsonb,
  after_value jsonb,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.cost_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  execution_id uuid NOT NULL REFERENCES public.operation_executions(id) ON DELETE CASCADE,
  step_id uuid REFERENCES public.operation_execution_steps(id) ON DELETE SET NULL,
  event_kind text NOT NULL CHECK (event_kind IN ('llm_request','mcp_tool_call','api_request','node_execution','workflow_execution','subscription_usage')),
  provider_type text,
  provider_id text,
  provider_name text,
  model_requested text,
  model_actual text,
  mcp_server_id text,
  mcp_tool_name text,
  api_node_id text,
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  status text NOT NULL CHECK (status IN ('attempted','succeeded','failed','timed_out','cancelled')),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms >= 0),
  input_tokens bigint CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens bigint CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cached_input_tokens bigint CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  cache_write_tokens bigint CHECK (cache_write_tokens IS NULL OR cache_write_tokens >= 0),
  reasoning_tokens bigint CHECK (reasoning_tokens IS NULL OR reasoning_tokens >= 0),
  quantity numeric(30,12),
  unit text,
  provider_request_id text,
  usage_source text NOT NULL CHECK (usage_source IN ('provider_reported','response_header','response_body','configured_fixed','estimated')),
  confidence text NOT NULL CHECK (confidence IN ('exact','estimated','unknown')),
  idempotency_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE public.cost_valuations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  usage_event_id uuid REFERENCES public.cost_usage_events(id) ON DELETE SET NULL,
  execution_id uuid NOT NULL REFERENCES public.operation_executions(id) ON DELETE CASCADE,
  step_id uuid REFERENCES public.operation_execution_steps(id) ON DELETE SET NULL,
  policy_id uuid REFERENCES public.cost_policies(id) ON DELETE SET NULL,
  policy_version_id uuid REFERENCES public.cost_policy_versions(id) ON DELETE SET NULL,
  valuation_type text NOT NULL CHECK (valuation_type IN ('estimated','effective','restated','reconciled','manual_adjustment')),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount numeric(24,12) NOT NULL,
  calculation_inputs jsonb NOT NULL DEFAULT '{}',
  calculation_breakdown jsonb NOT NULL DEFAULT '{}',
  calculated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  supersedes_valuation_id uuid REFERENCES public.cost_valuations(id) ON DELETE SET NULL,
  created_by uuid
);

CREATE TABLE public.cost_subscription_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES public.cost_policies(id) ON DELETE CASCADE,
  provider_id text,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  amount numeric(24,12) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  allocation_method text NOT NULL CHECK (allocation_method IN ('equal_execution','tokens','calls','weighted')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','provisional','closed')),
  closed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (period_end > period_start)
);

CREATE TABLE public.cost_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('organization','provider','workflow','agent','node')),
  target_id text NOT NULL,
  period text NOT NULL CHECK (period IN ('monthly','quarterly','yearly','custom')),
  period_start timestamptz,
  period_end timestamptz,
  amount numeric(24,12) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  alert_thresholds numeric[] NOT NULL DEFAULT ARRAY[0.5,0.8,1.0]::numeric[],
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.cost_reconciliation_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  execution_id uuid REFERENCES public.operation_executions(id) ON DELETE SET NULL,
  usage_event_id uuid REFERENCES public.cost_usage_events(id) ON DELETE SET NULL,
  provider_id text NOT NULL,
  provider_request_id text,
  billing_period_start timestamptz NOT NULL,
  billing_period_end timestamptz NOT NULL,
  billed_amount numeric(24,12) NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  source_reference text,
  imported_by uuid,
  imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (billing_period_end > billing_period_start)
);

CREATE INDEX operation_executions_org_started ON public.operation_executions(organization_id, started_at DESC);
CREATE INDEX operation_steps_execution ON public.operation_execution_steps(execution_id, sequence, attempt);
CREATE INDEX cost_policy_versions_active ON public.cost_policy_versions(organization_id, policy_id, effective_from DESC) WHERE status IN ('active','scheduled');
CREATE INDEX cost_policy_assignments_lookup ON public.cost_policy_assignments(organization_id, target_type, target_id, effective_from DESC);
CREATE INDEX cost_usage_events_execution ON public.cost_usage_events(execution_id, started_at);
CREATE INDEX cost_usage_events_provider ON public.cost_usage_events(organization_id, provider_id, started_at DESC);
CREATE INDEX cost_valuations_execution ON public.cost_valuations(execution_id, valuation_type, calculated_at);
-- Retried delivery may rediscover the same usage event. There must still be
-- only one calculated estimate/effective allocation for that event/version.
CREATE UNIQUE INDEX cost_valuations_usage_policy_unique ON public.cost_valuations(
  usage_event_id,
  COALESCE(policy_version_id, '00000000-0000-0000-0000-000000000000'::uuid),
  valuation_type
) WHERE usage_event_id IS NOT NULL AND valuation_type IN ('estimated','effective');

ALTER TABLE public.operation_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_execution_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_policy_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_policy_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_valuations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_subscription_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_reconciliation_adjustments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.operation_executions, public.operation_execution_steps,
  public.cost_policies, public.cost_policy_versions, public.cost_policy_assignments,
  public.cost_policy_audit_events, public.cost_usage_events, public.cost_valuations,
  public.cost_subscription_periods, public.cost_budgets,
  public.cost_reconciliation_adjustments FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.operation_executions, public.operation_execution_steps,
  public.cost_policies, public.cost_policy_versions, public.cost_policy_assignments,
  public.cost_policy_audit_events, public.cost_usage_events, public.cost_valuations,
  public.cost_subscription_periods, public.cost_budgets,
  public.cost_reconciliation_adjustments TO service_role;

CREATE FUNCTION public.protect_published_cost_policy_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'Published cost policy versions are immutable.' USING ERRCODE='P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER protect_published_cost_policy_version
BEFORE UPDATE OR DELETE ON public.cost_policy_versions
FOR EACH ROW EXECUTE FUNCTION public.protect_published_cost_policy_version();

REVOKE ALL ON FUNCTION public.protect_published_cost_policy_version() FROM PUBLIC, anon, authenticated;
