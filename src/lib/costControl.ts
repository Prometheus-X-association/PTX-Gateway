import { supabase } from "@/integrations/supabase/client";

const sessionId = () => {
  const key = "ptx-cost-control-session";
  try {
    let value = sessionStorage.getItem(key);
    if (!value) { value = `${crypto.randomUUID()}${crypto.randomUUID()}`; sessionStorage.setItem(key, value); }
    return value;
  } catch { return `${crypto.randomUUID()}${crypto.randomUUID()}`; }
};

export async function costControl(action: string, organizationId: string | null | undefined, body: Record<string, unknown> = {}, orgExecutionToken?: string | null) {
  const { data, error } = await supabase.functions.invoke("cost-control", {
    headers: organizationId ? { "x-organization-id": organizationId } : {},
    body: { action, ...body, ...(orgExecutionToken ? { org_execution_token: orgExecutionToken, workflow_session_id: sessionId() } : {}) },
  });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error || error.message || "Cost control request failed.");
  }
  if (!data?.ok) throw new Error(data?.error || "Cost control request failed.");
  return data;
}

export interface BrowserCostExecution {
  executionId: string;
  executionToken: string;
}
