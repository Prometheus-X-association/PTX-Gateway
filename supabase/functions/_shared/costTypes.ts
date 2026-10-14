export type CostExecutionKind = "workflow" | "direct_agent";
export type CostExecutionMode = "browser" | "backend";
export type CostExecutionSource = "result_chat" | "dashboard" | "api" | "webhook" | "builder_test";
export type CostEventKind = "llm_request" | "mcp_tool_call" | "api_request" | "node_execution" | "workflow_execution" | "subscription_usage";
export type CostUsageSource = "provider_reported" | "response_header" | "response_body" | "configured_fixed" | "estimated";
export type CostConfidence = "exact" | "estimated" | "unknown";
export type CostValuationType = "estimated" | "effective" | "restated" | "reconciled" | "manual_adjustment";

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

export interface NodeCostConfiguration {
  mode: "none" | "fixed_attempt" | "fixed_success" | "quantity" | "duration" | "policy";
  policyId?: string;
  fixedAmount?: string;
  currency?: string;
  quantitySource?: "response_body" | "response_header";
  quantityPath?: string;
  quantityHeader?: string;
  unit?: string;
  inclusive?: boolean;
}

export type CostFormulaExpression =
  | { type: "number"; value: string }
  | { type: "variable"; name: string }
  | { type: "binary"; operator: "+" | "-" | "*" | "/"; left: CostFormulaExpression; right: CostFormulaExpression }
  | { type: "conditional"; condition: CostFormulaCondition; whenTrue: CostFormulaExpression; whenFalse: CostFormulaExpression }
  | { type: "function"; name: "min" | "max" | "round" | "ceil" | "floor"; arguments: CostFormulaExpression[] };

export interface CostFormulaCondition {
  type: "comparison";
  operator: "eq" | "ne" | "gt" | "gte" | "lt" | "lte";
  left: CostFormulaExpression;
  right: CostFormulaExpression;
}

export interface CostPolicyDefinition {
  formula: CostFormulaExpression;
  rates?: Record<string, string>;
  chargeOn?: "attempt" | "success";
  inclusive?: boolean;
  allocation?: "equal_execution" | "tokens" | "calls" | "weighted";
}

export interface CostUsageEventInput {
  executionId: string;
  stepId?: string;
  eventKind: CostEventKind;
  providerType?: string;
  providerId?: string;
  providerName?: string;
  modelRequested?: string;
  modelActual?: string;
  mcpServerId?: string;
  mcpToolName?: string;
  apiNodeId?: string;
  attempt?: number;
  status: "attempted" | "succeeded" | "failed" | "timed_out" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  usage?: ProviderUsage;
  quantity?: string;
  unit?: string;
  providerRequestId?: string;
  usageSource: CostUsageSource;
  confidence: CostConfidence;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}
