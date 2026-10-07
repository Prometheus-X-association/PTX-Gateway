import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { adminClient } from "../_shared/workflowAccess.ts";
import { cors, json, publicRun, readBody } from "../_shared/workflowRuns.ts";
import { decryptForOrganization, HttpError, object } from "../_shared/workflowSecurity.ts";
import { resumeRun, verifyInteractionToken } from "../_shared/workflowInteraction.ts";

export const handleWorkflowInteraction = async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    if (request.method !== "POST") throw new HttpError(405, "Use POST.");
    let body: any;
    try { body = object(JSON.parse(String(await readBody(request, 120_000)))); } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, "Invalid JSON body."); }
    const admin = adminClient();
    const run = await verifyInteractionToken(body.token, admin);
    if (body.action === "resume") {
      if (!body.waitingVersion) throw new HttpError(400, "The question version is required.");
      return json(await resumeRun(admin, run, body), 202);
    }
    if (body.action !== "get") throw new HttpError(400, "Unknown interaction action.");
    const { workflow } = await decryptForOrganization(admin, run.organization_id, run.snapshot.ciphertext);
    const view = publicRun(run);
    // A participant may see only this run's question/result, never inputs, history, or credentials.
    return new Response(JSON.stringify({ ok: true, run: { id: view.id, workflowName: view.workflowName, status: view.status,
      waiting: run.status === "waiting_for_input" ? view.waiting : null, waitingVersion: run.waiting_version,
      waitingExpiresAt: run.waiting_expires_at, output: run.status === "succeeded" ? view.output : null,
      stopReason: view.stopReason }, returnUrl: workflow.execution?.notifications?.returnUrl || null }),
      { headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    if (!(error instanceof HttpError)) console.error("Workflow interaction failed", error);
    return json({ ok: false, error: error instanceof HttpError ? error.message : "Interaction operation failed." }, error instanceof HttpError ? error.status : 500);
  }
};
serve(handleWorkflowInteraction);
