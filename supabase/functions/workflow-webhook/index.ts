import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { adminClient } from "../_shared/workflowAccess.ts";
import { createRun, json, readBody } from "../_shared/workflowRuns.ts";
import { decryptForOrganization, hmac, equal, HttpError, mapWebhookInput, object } from "../_shared/workflowSecurity.ts";

export const handleWorkflowWebhook = async (request: Request) => {
  try {
    if (request.method !== "POST") throw new HttpError(405, "Use POST.");
    const endpointId = new URL(request.url).pathname.split("/").filter(Boolean).at(-1);
    const admin = adminClient();
    const { data: endpoint, error } = await admin.from("workflow_webhooks").select("*").eq("id", endpointId).eq("enabled", true).maybeSingle();
    if (error || !endpoint) throw new HttpError(404, "Webhook was not found.");
    const timestamp = request.headers.get("x-workflow-timestamp") || "";
    const deliveryId = request.headers.get("x-workflow-delivery-id") || "";
    const signature = request.headers.get("x-workflow-signature") || "";
    if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) throw new HttpError(401, "Webhook timestamp is invalid or expired.");
    if (!deliveryId || deliveryId.length > 200) throw new HttpError(400, "A delivery ID of at most 200 characters is required.");
    const rawBody = String(await readBody(request));
    const secret = await decryptForOrganization(admin, endpoint.organization_id, endpoint.secret_ciphertext);
    if (!equal(await hmac(secret, `${timestamp}.${deliveryId}.${rawBody}`), signature.replace(/^sha256=/, ""))) throw new HttpError(401, "Invalid webhook signature.");
    let payload: unknown;
    try { payload = JSON.parse(rawBody); } catch { throw new HttpError(400, "Invalid JSON payload."); }
    const input = mapWebhookInput(payload, object(endpoint.input_mapping));
    const result = await createRun(admin, { orgId: endpoint.organization_id, callerId: `webhook:${endpoint.id}`, isAdmin: false },
      { ...input, workflowId: endpoint.workflow_id }, "webhook", deliveryId, { id: endpoint.id, deliveryId });
    return json({ ok: true, ...result }, 202);
  } catch (error) {
    if (!(error instanceof HttpError)) console.error("Workflow webhook failed", error);
    return json({ ok: false, error: error instanceof HttpError ? error.message : "Webhook operation failed." }, error instanceof HttpError ? error.status : 500);
  }
};

serve(handleWorkflowWebhook);
