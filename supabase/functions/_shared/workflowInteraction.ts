import { equal, hmac, HttpError, object } from "./workflowSecurity.ts";

export function waitPolicy(data: Record<string, any>) {
  const bounded = (value: unknown, fallback: number, min: number, max: number) => Math.max(min, Math.min(max, Number(value ?? fallback)));
  return { responseTimeoutSeconds: Math.round(bounded(data.responseTimeoutHours, 48, 1 / 60, 720) * 3600),
    reminderIntervalSeconds: Math.round(bounded(data.reminderIntervalHours, 12, 1 / 60, 720) * 3600),
    maxReminders: Math.floor(bounded(data.maxReminders, 3, 0, 20)) };
}
export function validateAnswer(waiting: any, answer: unknown) {
  if (typeof answer !== "string" || !answer.trim() || answer.length > 100_000) throw new HttpError(400, "A valid answer is required.");
  const normalized = answer.trim().toLocaleLowerCase();
  if (waiting.inputType === "yes_no" && !["yes", "y", "no", "n"].includes(normalized)) throw new HttpError(400, "Please answer yes or no.");
  if (waiting.inputType === "select" && waiting.options?.length && !waiting.options.some((option: string) => option.trim().toLocaleLowerCase() === normalized)) throw new HttpError(400, "Please choose one of the provided options.");
}
function tokenSecret() {
  const secret = Deno.env.get("WORKFLOW_INTERNAL_SECRET");
  if (!secret) throw new HttpError(503, "Workflow interaction signing is not configured.");
  return secret;
}
export async function interactionToken(run: any) {
  const expiry = Math.floor(Date.parse(run.interaction_expires_at) / 1000);
  if (!Number.isFinite(expiry)) throw new HttpError(503, "Run interaction expiry is missing.");
  const signature = await hmac(tokenSecret(), `interaction.${run.id}.${run.organization_id}.${expiry}`);
  return `${run.id}.${expiry}.${signature}`;
}
export async function interactionUrl(run: any) {
  const base = Deno.env.get("WORKFLOW_INTERACTION_BASE_URL");
  if (!base) return null;
  const url = new URL("/workflow/respond", base);
  url.hash = `token=${await interactionToken(run)}`;
  return url.toString();
}
export async function verifyInteractionToken(token: unknown, admin: any) {
  if (typeof token !== "string" || token.length > 200 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.\d{10}\.[0-9a-f]{64}$/.test(token)) throw new HttpError(401, "Invalid interaction link.");
  const [id, expiry, signature] = token.split(".");
  const { data: run, error } = await admin.from("workflow_runs").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!run || !equal(await hmac(tokenSecret(), `interaction.${id}.${run.organization_id}.${expiry}`), signature) || Math.floor(Date.parse(run.interaction_expires_at) / 1000) !== Number(expiry)) throw new HttpError(401, "Invalid interaction link.");
  if (Number(expiry) <= Date.now() / 1000) throw new HttpError(410, "This interaction link has expired.");
  return run;
}
export async function resumeRun(admin: any, run: any, body: Record<string, any>) {
  if (typeof body.waitingVersion !== "string" || !body.waitingVersion) throw new HttpError(400, "The question version is required.");
  if (run.status !== "waiting_for_input" || body.nodeId !== run.waiting?.nodeId || body.waitingVersion !== run.waiting_version) throw new HttpError(409, "This question is no longer waiting for an answer.");
  validateAnswer(run.waiting, body.answer);
  const { data, error } = await admin.rpc("resume_workflow_run", { p_run_id: run.id, p_organization_id: run.organization_id, p_node_id: body.nodeId, p_waiting_version: run.waiting_version, p_answer: body.answer });
  if (error) throw error;
  if (!data) throw new HttpError(409, "This question was answered or its response deadline expired.");
  return { ok: true, runId: run.id, status: "queued" };
}
export function validateInteractionSettings(workflow: any) {
  for (const node of workflow.graph.nodes) if (node.type === "user_input") {
    for (const key of ["responseTimeoutHours", "reminderIntervalHours"]) {
      const value = node.data[key];
      if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 1 / 60 || value > 720)) throw new HttpError(400, "Response timeout and reminder interval must be between one minute and 30 days.");
    }
    if (node.data.maxReminders !== undefined && (!Number.isInteger(node.data.maxReminders) || node.data.maxReminders < 0 || node.data.maxReminders > 20)) throw new HttpError(400, "Maximum reminders must be between 0 and 20.");
  }
  const settings = object(workflow.execution?.notifications);
  for (const key of ["url", "returnUrl"]) if (settings[key]) {
    let url: URL; try { url = new URL(settings[key]); } catch { throw new HttpError(400, "Notification and return URLs must be valid HTTPS URLs."); }
    if (url.protocol !== "https:" || url.username || url.password || settings[key].length > 2000) throw new HttpError(400, "Notification and return URLs must be HTTPS URLs without embedded credentials.");
  }
  if (settings.url && (typeof settings.secret !== "string" || settings.secret.length < 32 || settings.secret.length > 512)) throw new HttpError(400, "Notification signing secret must contain at least 32 characters.");
  for (const [key, min, max] of [["interactionTtlHours", 1, 720], ["maxAttempts", 1, 10]] as const) if (settings[key] !== undefined && (!Number.isInteger(settings[key]) || settings[key] < min || settings[key] > max)) throw new HttpError(400, `Invalid ${key}.`);
}
