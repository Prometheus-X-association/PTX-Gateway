import { equal, hmac, HttpError } from "./workflowSecurity.ts";

const secret = () => Deno.env.get("COST_EXECUTION_SECRET") || Deno.env.get("WORKFLOW_INTERNAL_SECRET") || Deno.env.get("SUPABASE_INTERNAL_JWT_SECRET");

export async function createCostExecutionToken(executionId: string, organizationId: string, ttlSeconds = 24 * 60 * 60) {
  const value = secret(); if (!value) throw new HttpError(503, "Execution metering signing is not configured.");
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${executionId}.${expires}.${await hmac(value, `${executionId}.${organizationId}.${expires}`)}`;
}

export async function verifyCostExecutionToken(token: unknown, executionId: string, organizationId: string) {
  const [id, expires, signature] = String(token || "").split("."); const value = secret();
  if (!value || id !== executionId || Number(expires) <= Date.now() / 1000 || !signature || !equal(signature, await hmac(value, `${id}.${organizationId}.${expires}`))) throw new HttpError(401, "Invalid or expired execution token.");
}
