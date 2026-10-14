import { decryptForOrganization, hmac, object } from "../../supabase/functions/_shared/workflowSecurity.ts";
import { interactionUrl } from "../../supabase/functions/_shared/workflowInteraction.ts";
import { assertAllowedOutboundUrl } from "../../supabase/functions/_shared/workflowHttp.ts";

export async function deliverNotification(admin: any, job: any, send: typeof fetch = fetch, validateUrl = assertAllowedOutboundUrl) {
  const { data: run, error } = await admin.from("workflow_runs").select("*").eq("id", job.run_id).eq("organization_id", job.organization_id).maybeSingle();
  if (error) throw error;
  const patch = async (values: Record<string, unknown>) => {
    const { error } = await admin.from("workflow_notifications").update({ ...values, lease_token: null, lease_expires_at: null }).eq("id", job.id).eq("lease_token", job.lease_token).eq("status", "delivering");
    if (error) throw error;
  };
  if (!run) { await patch({ status: "skipped", last_error: "Run no longer exists." }); return; }
  let workflow: any;
  try { ({ workflow } = await decryptForOrganization(admin, run.organization_id, run.snapshot.ciphertext)); }
  catch {
    await patch({ status: job.attempts >= 6 ? "failed" : "pending", last_error: "Run notification configuration could not be decrypted.",
      available_at: new Date(Date.now() + Math.min(3600, 5 * 2 ** Math.min(job.attempts - 1, 10)) * 1000).toISOString() });
    return;
  }
  const settings = object(workflow.execution?.notifications);
  if (!settings.url) { await patch({ status: "skipped", last_error: "No notification endpoint configured." }); return; }
  if (job.event_type !== "completed" && (run.status !== "waiting_for_input" || run.waiting_version !== job.payload.waitingVersion || Date.parse(run.waiting_expires_at) <= Date.now())) {
    await patch({ status: "skipped", last_error: "Question was answered or expired." }); return;
  }
  const maxAttempts = Math.max(1, Math.min(10, Number(settings.maxAttempts ?? 6)));
  if (job.attempts > maxAttempts) { await patch({ status: "failed", last_error: "Delivery attempts exhausted after an interrupted delivery." }); return; }
  try {
    const url = new URL(settings.url);
    if (url.protocol !== "https:") throw new Error("Notification URL must use HTTPS.");
    await validateUrl(url, workflow.execution?.allowedOutboundHosts);
    const body = JSON.stringify({ eventId: job.id, type: `workflow.${job.event_type}`, runId: run.id, organizationId: run.organization_id,
      workflowId: run.workflow_id, workflowName: run.workflow_name, ...job.payload,
      ...(job.event_type !== "completed" ? { interactionUrl: await interactionUrl(run) } : {}) });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await send(url, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(20_000), body,
      headers: { "Content-Type": "application/json", "x-workflow-timestamp": timestamp, "x-workflow-delivery-id": job.id,
        "x-workflow-signature": await hmac(settings.secret, `${timestamp}.${job.id}.${body}`) } });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`Notification endpoint returned HTTP ${response.status}.`);
    await patch({ status: "delivered", delivered_at: new Date().toISOString(), last_error: null });
  } catch (error) {
    // Do not store response bodies or endpoint credentials in execution logs.
    await patch({ status: job.attempts >= maxAttempts ? "failed" : "pending", last_error: error instanceof Error && /^Notification endpoint returned HTTP \d+\.$/.test(error.message) ? error.message : "Notification delivery failed; check endpoint availability and public HTTPS URL.",
      available_at: new Date(Date.now() + Math.min(3600, 5 * 2 ** Math.min(job.attempts - 1, 10)) * 1000).toISOString() });
  }
}
export async function maintainInteractions(admin: any) {
  const { error } = await admin.rpc("maintain_workflow_interactions", {});
  if (error) throw error;
  const { data: jobs, error: claimError } = await admin.rpc("claim_workflow_notification", {});
  if (claimError) throw claimError;
  if (jobs?.[0]) await deliverNotification(admin, jobs[0]);
}

let lastRetentionSweep = 0;
export async function maintainRetention(admin: any, now = Date.now()) {
  if (now - lastRetentionSweep < 60 * 60 * 1000) return;
  const { error } = await admin.rpc("cleanup_workflow_runs", { p_batch: 500 });
  if (error) throw error;
  const { error: heartbeatError } = await admin.rpc("cleanup_workflow_worker_heartbeats", {});
  if (heartbeatError) throw heartbeatError;
  lastRetentionSweep = now;
}
