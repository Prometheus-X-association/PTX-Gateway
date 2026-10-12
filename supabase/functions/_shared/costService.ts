import { evaluateCostPolicy } from "./costEngine.ts";
import type { CostFormulaExpression, CostPolicyDefinition, CostUsageEventInput, NodeCostConfiguration } from "./costTypes.ts";
import type { adminClient } from "./workflowAccess.ts";

type AdminClient = ReturnType<typeof adminClient>;
interface CostPolicyAssignment {
  id: string; policy_id: string; target_type: string; target_id: string; precedence?: number;
  effective_from: string; resolvedRank?: number;
}
interface CostPolicyVersion { id: string; definition?: Omit<CostPolicyDefinition, "formula">; formula_ast: CostFormulaExpression; effective_until?: string | null }

export interface CostContext {
  organizationId: string;
  workflowId?: string;
  nodeId?: string;
  agentId?: string;
  providerId?: string;
  model?: string;
  mcpServerId?: string;
  mcpToolName?: string;
  explicitPolicyId?: string;
}

const targetCandidates = (context: CostContext) => [
  context.nodeId && context.workflowId ? { type: "workflow_node", id: `${context.workflowId}:${context.nodeId}`, rank: 90 } : null,
  context.nodeId ? { type: "api_node", id: context.nodeId, rank: 85 } : null,
  context.mcpToolName && context.mcpServerId ? { type: "mcp_tool", id: `${context.mcpServerId}:${context.mcpToolName}`, rank: 80 } : null,
  context.model && context.providerId ? { type: "llm_model", id: `${context.providerId}:${context.model}`, rank: 75 } : null,
  context.agentId ? { type: "agent", id: context.agentId, rank: 70 } : null,
  context.workflowId ? { type: "workflow", id: context.workflowId, rank: 60 } : null,
  context.mcpServerId ? { type: "mcp_server", id: context.mcpServerId, rank: 50 } : null,
  context.providerId ? { type: "llm_provider", id: context.providerId, rank: 50 } : null,
  { type: "organization", id: context.organizationId, rank: 10 },
].filter(Boolean) as Array<{ type: string; id: string; rank: number }>;

export async function resolveCostPolicy(admin: AdminClient, context: CostContext, at = new Date().toISOString()) {
  let policyId = context.explicitPolicyId;
  let assignment: CostPolicyAssignment | null = null;
  if (!policyId) {
    const candidates = targetCandidates(context);
    const { data, error } = await admin.from("cost_policy_assignments").select("*")
      .eq("organization_id", context.organizationId).is("retired_at", null).lte("effective_from", at)
      .or(`effective_until.is.null,effective_until.gt.${at}`);
    if (error) throw error;
    assignment = ((data ?? []) as CostPolicyAssignment[]).map((item) => {
      const candidate = candidates.find((value) => value.type === item.target_type && value.id === item.target_id);
      return candidate ? { ...item, resolvedRank: candidate.rank + Number(item.precedence || 0) } : null;
    }).filter((item): item is CostPolicyAssignment & { resolvedRank: number } => Boolean(item))
      .sort((a, b) => b.resolvedRank - a.resolvedRank || String(b.effective_from).localeCompare(String(a.effective_from)))[0] ?? null;
    policyId = assignment?.policy_id;
  }
  if (!policyId) return null;
  const { data: policy, error: policyError } = await admin.from("cost_policies").select("*").eq("organization_id", context.organizationId).eq("id", policyId).maybeSingle();
  if (policyError) throw policyError;
  if (!policy || policy.archived_at) return null;
  const { data: versions, error: versionError } = await admin.from("cost_policy_versions").select("*")
    .eq("organization_id", context.organizationId).eq("policy_id", policyId).in("status", ["active", "scheduled"])
    .lte("effective_from", at).order("version_number", { ascending: false }).limit(10);
  if (versionError) throw versionError;
  const version = ((versions ?? []) as CostPolicyVersion[]).find((item) => !item.effective_until || item.effective_until > at);
  return version ? { policy, version, assignment } : null;
}

export async function ensureOperationExecution(admin: AdminClient, values: Record<string, unknown>) {
  if (values.workflow_run_id) {
    const { data: existing, error } = await admin.from("operation_executions").select("*").eq("organization_id", values.organization_id).eq("workflow_run_id", values.workflow_run_id).maybeSingle();
    if (error) throw error;
    if (existing) return existing;
  }
  const { data, error } = await admin.from("operation_executions").insert(values).select("*").single();
  if (error) throw error;
  return data;
}

export async function recordUsageAndValuation(admin: AdminClient, organizationId: string, event: CostUsageEventInput, context: CostContext) {
  const usage = event.usage ?? {};
  const row = {
    organization_id: organizationId, execution_id: event.executionId, step_id: event.stepId ?? null,
    event_kind: event.eventKind, provider_type: event.providerType ?? null, provider_id: event.providerId ?? null,
    provider_name: event.providerName ?? null, model_requested: event.modelRequested ?? null, model_actual: event.modelActual ?? null,
    mcp_server_id: event.mcpServerId ?? null, mcp_tool_name: event.mcpToolName ?? null, api_node_id: event.apiNodeId ?? null,
    attempt: event.attempt ?? 1, status: event.status, started_at: event.startedAt, finished_at: event.finishedAt ?? null,
    duration_ms: event.durationMs ?? null, input_tokens: usage.inputTokens ?? null, output_tokens: usage.outputTokens ?? null,
    cached_input_tokens: usage.cachedInputTokens ?? null, cache_write_tokens: usage.cacheWriteTokens ?? null,
    reasoning_tokens: usage.reasoningTokens ?? null, quantity: event.quantity ?? null, unit: event.unit ?? null,
    provider_request_id: event.providerRequestId ?? null, usage_source: event.usageSource, confidence: event.confidence,
    idempotency_key: event.idempotencyKey, metadata: event.metadata ?? {},
  };
  const { data: inserted, error } = await admin.from("cost_usage_events").upsert(row, { onConflict: "organization_id,idempotency_key", ignoreDuplicates: true }).select("*").maybeSingle();
  if (error) throw error;
  let usageEvent = inserted;
  if (!usageEvent) {
    const result = await admin.from("cost_usage_events").select("*").eq("organization_id", organizationId).eq("idempotency_key", event.idempotencyKey).single();
    if (result.error) throw result.error;
    usageEvent = result.data;
  }
  const resolved = await resolveCostPolicy(admin, { ...context, organizationId }, event.finishedAt ?? event.startedAt);
  if (!resolved) return { usageEvent, valuation: null };
  const definition = { ...(resolved.version.definition ?? {}), formula: resolved.version.formula_ast } as CostPolicyDefinition;
  if (definition.chargeOn === "success" && event.status !== "succeeded") return { usageEvent, valuation: null };
  const calculation = evaluateCostPolicy(definition, {
    input_tokens: usage.inputTokens ?? 0, output_tokens: usage.outputTokens ?? 0,
    cached_input_tokens: usage.cachedInputTokens ?? 0, cache_write_tokens: usage.cacheWriteTokens ?? 0,
    reasoning_tokens: usage.reasoningTokens ?? 0, request_count: event.eventKind === "llm_request" || event.eventKind === "api_request" ? 1 : 0,
    tool_call_count: event.eventKind === "mcp_tool_call" ? 1 : 0, attempt_count: event.attempt ?? 1,
    duration_ms: event.durationMs ?? 0, quantity: event.quantity ?? 0, success: event.status === "succeeded",
  });
  const valuationRow = {
    organization_id: organizationId, usage_event_id: usageEvent.id, execution_id: event.executionId, step_id: event.stepId ?? null,
    policy_id: resolved.policy.id, policy_version_id: resolved.version.id, valuation_type: "estimated", currency: resolved.policy.currency,
    amount: calculation.amount, calculation_inputs: calculation.inputs,
    calculation_breakdown: { ...calculation.breakdown, assignmentId: resolved.assignment?.id ?? null, inclusive: Boolean(definition.inclusive) },
  };
  const { data: valuation, error: valuationError } = await admin.from("cost_valuations").insert(valuationRow).select("*").single();
  if (valuationError?.code === "23505") {
    const existing = await admin.from("cost_valuations").select("*").eq("usage_event_id", usageEvent.id)
      .eq("policy_version_id", resolved.version.id).eq("valuation_type", "estimated").single();
    if (existing.error) throw existing.error;
    return { usageEvent, valuation: existing.data };
  }
  if (valuationError) throw valuationError;
  return { usageEvent, valuation };
}

export async function recordNodeUsageAndValuation(admin: AdminClient, organizationId: string, event: CostUsageEventInput, context: CostContext, cost?: NodeCostConfiguration) {
  const result = await recordUsageAndValuation(admin, organizationId, event, { ...context, explicitPolicyId: cost?.policyId || context.explicitPolicyId });
  const amount = fixedNodeAmount(cost, event.status);
  if (!amount || result.valuation) return result;
  const currency = String(cost?.currency || "EUR").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Node cost currency must be a three-letter ISO code.");
  const { data: valuation, error } = await admin.from("cost_valuations").insert({ organization_id: organizationId,
    usage_event_id: result.usageEvent.id, execution_id: event.executionId, step_id: event.stepId ?? null,
    valuation_type: "estimated", currency, amount, calculation_inputs: { configuredAmount: amount, status: event.status },
    calculation_breakdown: { source: "workflow_node_configuration", amount, inclusive: Boolean(cost?.inclusive) },
  }).select("*").single();
  if (error?.code === "23505") {
    const existing = await admin.from("cost_valuations").select("*").eq("usage_event_id", result.usageEvent.id)
      .is("policy_version_id", null).eq("valuation_type", "estimated").single();
    if (existing.error) throw existing.error;
    return { usageEvent: result.usageEvent, valuation: existing.data };
  }
  if (error) throw error;
  return { usageEvent: result.usageEvent, valuation };
}

export function fixedNodeAmount(cost: NodeCostConfiguration | undefined, status: string): string | null {
  if (!cost || cost.mode === "none" || cost.mode === "policy" || cost.mode === "quantity" || cost.mode === "duration") return null;
  if (cost.mode === "fixed_success" && status !== "succeeded") return null;
  return cost.fixedAmount?.trim() || null;
}
