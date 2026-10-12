import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { adminClient, authorize, checkWorkflowAccess, loadWorkflow } from "../_shared/workflowAccess.ts";
import type { Principal } from "../_shared/workflowAccess.ts";
import { decimal, decimalString, evaluateCostPolicy, validateCostFormula } from "../_shared/costEngine.ts";
import { hash, HttpError, object } from "../_shared/workflowSecurity.ts";
import type { CostPolicyDefinition } from "../_shared/costTypes.ts";
import { createCostExecutionToken, verifyCostExecutionToken } from "../_shared/costExecutionToken.ts";
import { recordNodeUsageAndValuation } from "../_shared/costService.ts";
import type { WorkflowNode } from "../_shared/workflowTypes.ts";

type AdminClient = ReturnType<typeof adminClient>;
type FormulaInput = string | number | bigint | boolean | null | undefined;
interface CostValuationRow { usage_event_id?: string; step_id?: string; currency: string; amount: string; calculation_breakdown?: { inclusive?: boolean } }
interface CostUsageRow { id: string; provider_name?: string; provider_id?: string; mcp_server_id?: string; event_kind: string; input_tokens?: number; output_tokens?: number }

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-organization-id" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const readBody = async (request: Request) => object(JSON.parse(await request.text() || "{}"));
const requireAdmin = (principal: { isAdmin: boolean }) => { if (!principal.isAdmin) throw new HttpError(403, "Organization admin permission is required."); };
const now = () => new Date().toISOString();
const uuid = (value: unknown, label: string) => { const result = String(value || ""); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) throw new HttpError(400, `${label} is invalid.`); return result; };

const audit = async (admin: AdminClient, principal: Principal, values: Record<string, unknown>) => {
  const { error } = await admin.from("cost_policy_audit_events").insert({ organization_id: principal.orgId, actor_user_id: principal.userId ?? null, ...values });
  if (error) throw error;
};

const ownExecution = async (admin: AdminClient, principal: Principal, body: Record<string, unknown>) => {
  const id = uuid(body.executionId, "Execution ID");
  const { data, error } = await admin.from("operation_executions").select("*").eq("id", id).eq("organization_id", principal.orgId).maybeSingle();
  if (error) throw error; if (!data) throw new HttpError(404, "Execution was not found.");
  if (!principal.isAdmin && data.metadata?.callerId !== principal.callerId) throw new HttpError(404, "Execution was not found.");
  await verifyCostExecutionToken(body.executionToken, id, principal.orgId);
  return data;
};

export const handleCostControlRequest = async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed.");
    const body = await readBody(request); const admin = adminClient(); const principal = await authorize(request, body, admin); const action = String(body.action || "summary");

    if (action === "start_execution") {
      const executionKind = body.executionKind === "direct_agent" ? "direct_agent" : "workflow";
      if (executionKind === "workflow") {
        const workflowId = String(body.workflowId || ""); checkWorkflowAccess(principal, workflowId);
        const { workflow } = await loadWorkflow(admin, principal.orgId, workflowId);
        const { data, error } = await admin.from("operation_executions").insert({ organization_id: principal.orgId, execution_kind: "workflow", execution_mode: "browser",
          execution_source: body.executionSource === "builder_test" ? "builder_test" : body.executionSource === "dashboard" ? "dashboard" : "result_chat",
          workflow_id: workflow.id, workflow_revision: workflow.revision ?? null, actor_user_id: principal.userId ?? null,
          metadata: { callerId: principal.callerId, workflowName: workflow.name } }).select("*").single();
        if (error) throw error;
        return json({ ok: true, execution: data, executionToken: await createCostExecutionToken(data.id, principal.orgId) }, 201);
      }
      const { data, error } = await admin.from("operation_executions").insert({ organization_id: principal.orgId, execution_kind: "direct_agent", execution_mode: "browser",
        execution_source: "result_chat", agent_id: String(body.agentId || "") || null, actor_user_id: principal.userId ?? null, metadata: { callerId: principal.callerId } }).select("*").single();
      if (error) throw error;
      return json({ ok: true, execution: data, executionToken: await createCostExecutionToken(data.id, principal.orgId) }, 201);
    }

    if (["step_start", "step_complete", "finish_execution", "pause_execution", "heartbeat"].includes(action)) {
      const execution = await ownExecution(admin, principal, body);
      if (action === "heartbeat") {
        const { error } = await admin.from("operation_executions").update({ updated_at: now() }).eq("id", execution.id).eq("status", "running"); if (error) throw error;
        return json({ ok: true });
      }
      if (action === "pause_execution") {
        const { error } = await admin.from("operation_executions").update({ status: "waiting", updated_at: now() }).eq("id", execution.id).in("status", ["running", "waiting"]); if (error) throw error;
        return json({ ok: true });
      }
      if (action === "step_start") {
        // The server owns ordering so a resumed browser session cannot reuse a
        // sequence number from its newly-created in-memory map.
        const { data: previousStep, error: sequenceError } = await admin.from("operation_execution_steps").select("sequence")
          .eq("execution_id", execution.id).order("sequence", { ascending: false }).limit(1).maybeSingle();
        if (sequenceError) throw sequenceError;
        const { data, error } = await admin.from("operation_execution_steps").insert({ organization_id: principal.orgId, execution_id: execution.id,
          node_id: String(body.nodeId || "") || null, node_type: String(body.nodeType || "") || null, node_name: String(body.nodeName || body.nodeId || "") || null,
          agent_id: String(body.agentId || "") || null, agent_kind: body.agentKind === "inline" ? "inline" : body.agentKind === "saved" ? "saved" : null,
          sequence: Math.max(0, Number(previousStep?.sequence) || 0) + 1, attempt: Math.max(1, Number(body.attempt) || 1), operation_id: String(body.operationId || "") || null, status: "running" }).select("*").single();
        if (error) throw error;
        return json({ ok: true, step: data }, 201);
      }
      if (action === "step_complete") {
        const stepId = uuid(body.stepId, "Step ID"); const status = ["succeeded","failed","waiting","cancelled","timed_out"].includes(body.status) ? body.status : "succeeded";
        const { data, error } = await admin.from("operation_execution_steps").update({ status, finished_at: now(), duration_ms: Math.max(0, Number(body.durationMs) || 0), metadata: object(body.metadata) })
          .eq("id", stepId).eq("execution_id", execution.id).eq("status", "running").select("*").maybeSingle();
        if (error) throw error; if (!data) throw new HttpError(409, "Execution step is no longer running.");
        // API nodes already emit a richer api_request event in the request function.
        if (execution.execution_mode === "browser" && execution.workflow_id && data.node_type !== "api") {
          try {
            const { workflow } = await loadWorkflow(admin, principal.orgId, execution.workflow_id);
            const node = workflow.graph?.nodes?.find((item: WorkflowNode) => item.id === data.node_id);
            await recordNodeUsageAndValuation(admin, principal.orgId, { executionId: execution.id, stepId: data.id,
              eventKind: "node_execution", attempt: data.attempt, status: status === "succeeded" ? "succeeded" : status === "waiting" ? "attempted" : status === "timed_out" ? "timed_out" : status === "cancelled" ? "cancelled" : "failed",
              startedAt: data.started_at, finishedAt: data.finished_at, durationMs: data.duration_ms, quantity: "1", unit: "execution",
              usageSource: "configured_fixed", confidence: "exact", idempotencyKey: `${execution.id}:${data.id}:node`, metadata: { nodeType: data.node_type } },
              { organizationId: principal.orgId, workflowId: execution.workflow_id, nodeId: data.node_id }, node?.cost);
          } catch (costError) { console.error("browser_node_cost_record_failed", costError); }
        }
        return json({ ok: true, step: data });
      }
      const status = ["succeeded","failed","cancelled","timed_out","incomplete"].includes(body.status) ? body.status : "succeeded";
      const { error } = await admin.from("operation_executions").update({ status, finished_at: now(), updated_at: now() }).eq("id", execution.id).in("status", ["running","waiting"]); if (error) throw error;
      return json({ ok: true });
    }

    requireAdmin(principal);

    if (action === "list_policies") {
      const [{ data: policies, error }, { data: versions, error: versionError }, { data: assignments, error: assignmentError }] = await Promise.all([
        admin.from("cost_policies").select("*").eq("organization_id", principal.orgId).order("name"),
        admin.from("cost_policy_versions").select("*").eq("organization_id", principal.orgId).order("version_number", { ascending: false }),
        admin.from("cost_policy_assignments").select("*").eq("organization_id", principal.orgId).order("created_at", { ascending: false }),
      ]);
      if (error || versionError || assignmentError) throw error || versionError || assignmentError;
      return json({ ok: true, policies, versions, assignments });
    }
    if (action === "create_policy") {
      const currency = String(body.currency || "EUR").toUpperCase(); if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, "Currency must be a three-letter ISO code.");
      const formula = body.formula ?? { type: "number", value: "0" }; validateCostFormula(formula, Object.keys(object(body.rates)));
      const { data: policy, error } = await admin.from("cost_policies").insert({ organization_id: principal.orgId, name: String(body.name || "").trim(), description: String(body.description || ""),
        policy_kind: String(body.policyKind || "composite"), currency, created_by: principal.userId ?? null }).select("*").single(); if (error) throw error;
      const definition = { rates: object(body.rates), chargeOn: body.chargeOn === "success" ? "success" : "attempt", inclusive: Boolean(body.inclusive) };
      const { data: version, error: versionError } = await admin.from("cost_policy_versions").insert({ organization_id: principal.orgId, policy_id: policy.id, version_number: 1,
        definition, formula_ast: formula, change_reason: String(body.changeReason || "Initial policy"), created_by: principal.userId ?? null, content_hash: await hash(JSON.stringify({ definition, formula })) }).select("*").single();
      if (versionError) throw versionError; await audit(admin, principal, { policy_id: policy.id, policy_version_id: version.id, action: "created", reason: version.change_reason, after_value: { policy, version } });
      return json({ ok: true, policy, version }, 201);
    }
    if (action === "create_draft") {
      const policyId = uuid(body.policyId, "Policy ID");
      const [{ data: latest, error }, { data: source, error: sourceError }] = await Promise.all([
        admin.from("cost_policy_versions").select("*").eq("organization_id", principal.orgId).eq("policy_id", policyId).order("version_number", { ascending: false }).limit(1).maybeSingle(),
        body.sourceVersionId
          ? admin.from("cost_policy_versions").select("*").eq("organization_id", principal.orgId).eq("policy_id", policyId).eq("id", uuid(body.sourceVersionId, "Source version ID")).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]); if (error || sourceError) throw error || sourceError;
      if (!latest) throw new HttpError(404, "Cost policy was not found.");
      const template = source ?? latest;
      const { data: version, error: insertError } = await admin.from("cost_policy_versions").insert({ organization_id: principal.orgId, policy_id: policyId, version_number: latest.version_number + 1,
        definition: template.definition, formula_ast: template.formula_ast, change_reason: String(body.changeReason || ""), created_by: principal.userId ?? null, content_hash: template.content_hash }).select("*").single(); if (insertError) throw insertError;
      await audit(admin, principal, { policy_id: policyId, policy_version_id: version.id, action: "draft_created", reason: version.change_reason, after_value: { ...version, source_version_id: template.id } });
      return json({ ok: true, version }, 201);
    }
    if (action === "update_draft") {
      const versionId = uuid(body.versionId, "Version ID"); const formula = body.formula; const definition = object(body.definition) as unknown as CostPolicyDefinition;
      if (!formula) throw new HttpError(400, "Formula is required."); validateCostFormula(formula, Object.keys(definition.rates ?? {}));
      const { data: before, error: beforeError } = await admin.from("cost_policy_versions").select("*").eq("organization_id", principal.orgId).eq("id", versionId).eq("status", "draft").maybeSingle(); if (beforeError) throw beforeError; if (!before) throw new HttpError(409, "Only draft versions can be edited.");
      const update = { definition, formula_ast: formula, change_reason: String(body.changeReason || before.change_reason), content_hash: await hash(JSON.stringify({ definition, formula })) };
      const { data: version, error } = await admin.from("cost_policy_versions").update(update).eq("id", versionId).eq("status", "draft").select("*").single(); if (error) throw error;
      await audit(admin, principal, { policy_id: before.policy_id, policy_version_id: version.id, action: "draft_updated", reason: update.change_reason, before_value: before, after_value: version });
      return json({ ok: true, version });
    }
    if (action === "validate_policy" || action === "simulate_policy") {
      const definition = object(body.definition) as unknown as CostPolicyDefinition; const formula = body.formula ?? definition.formula; if (!formula) throw new HttpError(400, "Formula is required.");
      const merged = { ...definition, formula }; validateCostFormula(formula, Object.keys(merged.rates ?? {}));
      const calculation = evaluateCostPolicy(merged, object(body.inputs) as Record<string, FormulaInput>);
      if (action === "simulate_policy") await audit(admin, principal, { policy_id: body.policyId || null, policy_version_id: body.versionId || null, action: "simulation_run", reason: String(body.reason || ""), after_value: calculation });
      return json({ ok: true, calculation });
    }
    if (action === "publish_policy") {
      const versionId = uuid(body.versionId, "Version ID"); const effectiveFrom = body.effectiveFrom ? new Date(body.effectiveFrom).toISOString() : now();
      const { data: before, error: beforeError } = await admin.from("cost_policy_versions").select("*").eq("organization_id", principal.orgId).eq("id", versionId).eq("status", "draft").maybeSingle(); if (beforeError) throw beforeError; if (!before) throw new HttpError(409, "Only a draft can be published.");
      validateCostFormula(before.formula_ast, Object.keys(object(before.definition?.rates)));
      const status = Date.parse(effectiveFrom) > Date.now() ? "scheduled" : "active";
      const { data: version, error } = await admin.from("cost_policy_versions").update({ status, effective_from: effectiveFrom, effective_until: body.effectiveUntil ? new Date(body.effectiveUntil).toISOString() : null,
        approved_by: principal.userId ?? null, approved_at: now(), published_by: principal.userId ?? null, published_at: now() }).eq("id", versionId).eq("status", "draft").select("*").single(); if (error) throw error;
      await audit(admin, principal, { policy_id: before.policy_id, policy_version_id: version.id, action: status === "scheduled" ? "scheduled" : "published", reason: String(body.reason || before.change_reason), before_value: before, after_value: version });
      return json({ ok: true, version });
    }
    if (action === "assign_policy") {
      const policyId = uuid(body.policyId, "Policy ID"); const targetType = String(body.targetType || ""); const targetId = String(body.targetId || "");
      if (!targetId) throw new HttpError(400, "Assignment target is required.");
      const { data: assignment, error } = await admin.from("cost_policy_assignments").insert({ organization_id: principal.orgId, policy_id: policyId, target_type: targetType, target_id: targetId,
        workflow_id: body.workflowId || null, node_id: body.nodeId || null, precedence: Number(body.precedence) || 0, effective_from: body.effectiveFrom ? new Date(body.effectiveFrom).toISOString() : now(),
        effective_until: body.effectiveUntil ? new Date(body.effectiveUntil).toISOString() : null, created_by: principal.userId ?? null }).select("*").single(); if (error) throw error;
      await audit(admin, principal, { policy_id: policyId, action: "assignment_changed", reason: String(body.reason || ""), after_value: assignment });
      return json({ ok: true, assignment }, 201);
    }
    if (action === "retire_assignment") {
      const assignmentId = uuid(body.assignmentId, "Assignment ID");
      const { data: before, error: beforeError } = await admin.from("cost_policy_assignments").select("*").eq("organization_id", principal.orgId).eq("id", assignmentId).maybeSingle();
      if (beforeError) throw beforeError; if (!before) throw new HttpError(404, "Policy assignment was not found.");
      const retiredAt = now();
      const update = { retired_at: retiredAt, ...(Date.parse(before.effective_from) < Date.parse(retiredAt) ? { effective_until: retiredAt } : {}) };
      const { data: assignment, error } = await admin.from("cost_policy_assignments").update(update).eq("id", assignmentId).select("*").single(); if (error) throw error;
      await audit(admin, principal, { policy_id: before.policy_id, action: "assignment_retired", reason: String(body.reason || "Retired in Agent Operations"), before_value: before, after_value: assignment });
      return json({ ok: true, assignment });
    }
    if (action === "archive_policy") {
      const policyId = uuid(body.policyId, "Policy ID");
      const { data: before, error: beforeError } = await admin.from("cost_policies").select("*").eq("organization_id", principal.orgId).eq("id", policyId).maybeSingle();
      if (beforeError) throw beforeError; if (!before) throw new HttpError(404, "Cost policy was not found.");
      const archivedAt = now();
      const { data: policy, error } = await admin.from("cost_policies").update({ archived_at: archivedAt }).eq("id", policyId).select("*").single(); if (error) throw error;
      const { error: assignmentError } = await admin.from("cost_policy_assignments").update({ retired_at: archivedAt }).eq("organization_id", principal.orgId).eq("policy_id", policyId).is("retired_at", null); if (assignmentError) throw assignmentError;
      await audit(admin, principal, { policy_id: policyId, action: "policy_archived", reason: String(body.reason || "Archived in Agent Operations"), before_value: before, after_value: policy });
      return json({ ok: true, policy });
    }
    if (action === "audit_history") {
      let query = admin.from("cost_policy_audit_events").select("*").eq("organization_id", principal.orgId).order("created_at", { ascending: false }).limit(500);
      if (body.policyId) query = query.eq("policy_id", body.policyId);
      const { data, error } = await query; if (error) throw error; return json({ ok: true, events: data });
    }
    if (action === "summary" || action === "list_executions") {
      const from = body.from ? new Date(body.from).toISOString() : new Date(Date.now() - 30 * 86400000).toISOString(); const to = body.to ? new Date(body.to).toISOString() : now();
      const [{ data: executions, error }, { data: valuations, error: valuationError }, { data: usage, error: usageError }] = await Promise.all([
        admin.from("operation_executions").select("*").eq("organization_id", principal.orgId).gte("started_at", from).lt("started_at", to).order("started_at", { ascending: false }).limit(500),
        admin.from("cost_valuations").select("*").eq("organization_id", principal.orgId).gte("calculated_at", from).lt("calculated_at", to).limit(10000),
        admin.from("cost_usage_events").select("*").eq("organization_id", principal.orgId).gte("started_at", from).lt("started_at", to).limit(10000),
      ]); if (error || valuationError || usageError) throw error || valuationError || usageError;
      if (action === "list_executions") return json({ ok: true, executions });
      const valuationRows = (valuations ?? []) as CostValuationRow[];
      const inclusiveSteps = new Set(valuationRows.filter((value) => value.step_id && value.calculation_breakdown?.inclusive === true).map((value) => value.step_id));
      const effectiveValuations = valuationRows.filter((value) => !value.step_id || !inclusiveSteps.has(value.step_id) || value.calculation_breakdown?.inclusive === true);
      const scaledTotals: Record<string, bigint> = {}; for (const value of effectiveValuations) scaledTotals[value.currency] = (scaledTotals[value.currency] ?? 0n) + decimal(value.amount);
      const totals = Object.fromEntries(Object.entries(scaledTotals).map(([currency, amount]) => [currency, decimalString(amount)]));
      const providers: Record<string, { events: number; inputTokens: number; outputTokens: number; scaledCosts: Record<string, bigint>; costs?: Record<string, string> }> = {};
      const usageRows = (usage ?? []) as CostUsageRow[]; const usageById = new Map(usageRows.map((item) => [item.id, item]));
      for (const item of usageRows) { const key = item.provider_name || item.provider_id || item.mcp_server_id || item.event_kind; const target = providers[key] ??= { events: 0, inputTokens: 0, outputTokens: 0, scaledCosts: {} }; target.events++; target.inputTokens += Number(item.input_tokens || 0); target.outputTokens += Number(item.output_tokens || 0); }
      for (const value of effectiveValuations) { const item = value.usage_event_id ? usageById.get(value.usage_event_id) : undefined; if (!item) continue; const key = item.provider_name || item.provider_id || item.mcp_server_id || item.event_kind; const target = providers[key] ??= { events: 0, inputTokens: 0, outputTokens: 0, scaledCosts: {} }; target.scaledCosts[value.currency] = (target.scaledCosts[value.currency] ?? 0n) + decimal(value.amount); }
      for (const target of Object.values(providers)) { target.costs = Object.fromEntries(Object.entries(target.scaledCosts).map(([currency, amount]) => [currency, decimalString(amount)])); delete target.scaledCosts; }
      return json({ ok: true, from, to, totals, executionCount: executions?.length ?? 0, usageEventCount: usage?.length ?? 0, providers, executions });
    }
    if (action === "execution_detail") {
      const executionId = uuid(body.executionId, "Execution ID");
      const [{ data: execution, error }, { data: steps, error: stepError }, { data: usage, error: usageError }, { data: valuations, error: valuationError }] = await Promise.all([
        admin.from("operation_executions").select("*").eq("organization_id", principal.orgId).eq("id", executionId).maybeSingle(),
        admin.from("operation_execution_steps").select("*").eq("organization_id", principal.orgId).eq("execution_id", executionId).order("sequence"),
        admin.from("cost_usage_events").select("*").eq("organization_id", principal.orgId).eq("execution_id", executionId).order("started_at"),
        admin.from("cost_valuations").select("*").eq("organization_id", principal.orgId).eq("execution_id", executionId).order("calculated_at"),
      ]); if (error || stepError || usageError || valuationError) throw error || stepError || usageError || valuationError; if (!execution) throw new HttpError(404, "Execution was not found.");
      const valuationRows = (valuations ?? []) as CostValuationRow[];
      const inclusiveSteps = new Set(valuationRows.filter((value) => value.step_id && value.calculation_breakdown?.inclusive === true).map((value) => value.step_id));
      const effectiveValuations = valuationRows.filter((value) => !value.step_id || !inclusiveSteps.has(value.step_id) || value.calculation_breakdown?.inclusive === true);
      const totalScaled: Record<string, bigint> = {}; const stepScaled: Record<string, Record<string, bigint>> = {};
      for (const value of effectiveValuations) { totalScaled[value.currency] = (totalScaled[value.currency] ?? 0n) + decimal(value.amount); if (value.step_id) { const target = stepScaled[value.step_id] ??= {}; target[value.currency] = (target[value.currency] ?? 0n) + decimal(value.amount); } }
      const totals = Object.fromEntries(Object.entries(totalScaled).map(([currency, amount]) => [currency, decimalString(amount)]));
      const stepTotals = Object.fromEntries(Object.entries(stepScaled).map(([stepId, values]) => [stepId, Object.fromEntries(Object.entries(values).map(([currency, amount]) => [currency, decimalString(amount)]))]));
      return json({ ok: true, execution, steps, usage, valuations, totals, stepTotals });
    }
    if (action === "list_budgets") { const { data, error } = await admin.from("cost_budgets").select("*").eq("organization_id", principal.orgId).order("created_at", { ascending: false }); if (error) throw error; return json({ ok: true, budgets: data }); }
    if (action === "save_budget") {
      const values = { organization_id: principal.orgId, name: String(body.name || "").trim(), target_type: body.targetType, target_id: String(body.targetId || principal.orgId), period: body.period || "monthly",
        period_start: body.periodStart || null, period_end: body.periodEnd || null, amount: String(body.amount || "0"), currency: String(body.currency || "EUR").toUpperCase(), alert_thresholds: body.alertThresholds || [0.5,0.8,1], enabled: body.enabled !== false, created_by: principal.userId ?? null };
      const query = body.id ? admin.from("cost_budgets").update(values).eq("id", uuid(body.id, "Budget ID")).eq("organization_id", principal.orgId) : admin.from("cost_budgets").insert(values);
      const { data, error } = await query.select("*").single(); if (error) throw error; return json({ ok: true, budget: data });
    }
    if (action === "list_subscriptions") { const { data, error } = await admin.from("cost_subscription_periods").select("*").eq("organization_id", principal.orgId).order("period_start", { ascending: false }); if (error) throw error; return json({ ok: true, subscriptions: data }); }
    if (action === "save_subscription") {
      const values = { organization_id: principal.orgId, policy_id: uuid(body.policyId, "Policy ID"), provider_id: body.providerId || null, period_start: new Date(body.periodStart).toISOString(), period_end: new Date(body.periodEnd).toISOString(),
        amount: String(body.amount), currency: String(body.currency || "EUR").toUpperCase(), allocation_method: body.allocationMethod || "equal_execution", status: body.status || "open", created_by: principal.userId ?? null };
      const { data, error } = await admin.from("cost_subscription_periods").insert(values).select("*").single(); if (error) throw error; return json({ ok: true, subscription: data }, 201);
    }
    if (action === "close_subscription") {
      const subscriptionId = uuid(body.subscriptionId, "Subscription ID");
      const { data: period, error } = await admin.from("cost_subscription_periods").select("*").eq("organization_id", principal.orgId).eq("id", subscriptionId).in("status", ["open","provisional"]).maybeSingle();
      if (error) throw error; if (!period) throw new HttpError(404, "Open subscription period was not found.");
      let usageQuery = admin.from("cost_usage_events").select("*").eq("organization_id", principal.orgId).gte("started_at", period.period_start).lt("started_at", period.period_end);
      if (period.provider_id) usageQuery = usageQuery.or(`provider_id.eq.${period.provider_id},mcp_server_id.eq.${period.provider_id}`);
      const { data: usage, error: usageError } = await usageQuery.limit(50000); if (usageError) throw usageError;
      const weights = new Map<string, bigint>();
      for (const item of usage ?? []) {
        const increment = period.allocation_method === "tokens" ? decimal(String(BigInt(item.input_tokens || 0) + BigInt(item.output_tokens || 0)))
          : period.allocation_method === "calls" ? decimal(1) : period.allocation_method === "weighted" ? decimal(String(item.metadata?.allocationWeight ?? 1)) : 0n;
        weights.set(item.execution_id, (weights.get(item.execution_id) ?? 0n) + (increment > 0n ? increment : 0n));
      }
      if (period.allocation_method === "equal_execution") for (const item of usage ?? []) weights.set(item.execution_id, decimal(1));
      const denominator = [...weights.values()].reduce((sum, value) => sum + value, 0n);
      const subscriptionAmount = decimal(period.amount);
      let allocated = 0n;
      const weightedExecutions = [...weights.entries()];
      if (denominator > 0n) for (let index = 0; index < weightedExecutions.length; index++) {
        const [executionId, weight] = weightedExecutions[index];
        const amount = index === weightedExecutions.length - 1 ? subscriptionAmount - allocated : subscriptionAmount * weight / denominator;
        allocated += amount;
        const idempotencyKey = `subscription:${period.id}:${executionId}`;
        const { data: usageEvent, error: eventError } = await admin.from("cost_usage_events").upsert({ organization_id: principal.orgId, execution_id: executionId,
          event_kind: "subscription_usage", status: "succeeded", started_at: period.period_start, finished_at: period.period_end,
          quantity: decimalString(weight), unit: period.allocation_method, usage_source: "configured_fixed", confidence: "exact", idempotency_key: idempotencyKey,
          metadata: { subscriptionPeriodId: period.id } }, { onConflict: "organization_id,idempotency_key" }).select("*").single(); if (eventError) throw eventError;
        const { data: existing } = await admin.from("cost_valuations").select("id").eq("organization_id", principal.orgId).eq("usage_event_id", usageEvent.id).eq("valuation_type", "effective").maybeSingle();
        if (!existing) { const { error: valuationError } = await admin.from("cost_valuations").insert({ organization_id: principal.orgId, usage_event_id: usageEvent.id, execution_id: executionId,
          policy_id: period.policy_id, valuation_type: "effective", currency: period.currency, amount: decimalString(amount), calculation_inputs: { subscriptionPeriodId: period.id, weight: decimalString(weight), denominator: decimalString(denominator) },
          calculation_breakdown: { allocationMethod: period.allocation_method, subscriptionAmount: period.amount, allocatedAmount: decimalString(amount) } }); if (valuationError) throw valuationError; }
      }
      const { data: closed, error: closeError } = await admin.from("cost_subscription_periods").update({ status: "closed", closed_at: now() }).eq("id", period.id).select("*").single(); if (closeError) throw closeError;
      await audit(admin, principal, { policy_id: period.policy_id, action: "subscription_closed", reason: String(body.reason || "Billing period closed"), after_value: { period: closed, allocations: weights.size } });
      return json({ ok: true, subscription: closed, allocations: weights.size });
    }
    if (action === "reconcile") {
      const executionId = body.executionId ? uuid(body.executionId, "Execution ID") : null; const usageEventId = body.usageEventId ? uuid(body.usageEventId, "Usage event ID") : null;
      const { data: adjustment, error } = await admin.from("cost_reconciliation_adjustments").insert({ organization_id: principal.orgId, execution_id: executionId, usage_event_id: usageEventId,
        provider_id: String(body.providerId || ""), provider_request_id: body.providerRequestId || null, billing_period_start: new Date(body.billingPeriodStart).toISOString(), billing_period_end: new Date(body.billingPeriodEnd).toISOString(),
        billed_amount: String(body.billedAmount), currency: String(body.currency || "EUR").toUpperCase(), source_reference: body.sourceReference || null, imported_by: principal.userId ?? null }).select("*").single(); if (error) throw error;
      if (executionId) { const { error: valuationError } = await admin.from("cost_valuations").insert({ organization_id: principal.orgId, usage_event_id: usageEventId, execution_id: executionId,
        valuation_type: "reconciled", currency: adjustment.currency, amount: adjustment.billed_amount, calculation_inputs: { adjustmentId: adjustment.id }, calculation_breakdown: { sourceReference: adjustment.source_reference }, created_by: principal.userId ?? null }); if (valuationError) throw valuationError; }
      return json({ ok: true, adjustment }, 201);
    }
    throw new HttpError(400, "Unknown cost-control action.");
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500; console.error("cost-control", error);
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, status);
  }
};

if (import.meta.main) serve(handleCostControlRequest);
