import { studioUuid } from './studioSchema.ts';
export type KnowledgeKind = 'rag' | 'knowledge_graph' | 'vector';
export type KnowledgeRecordKind = 'document' | 'skill' | 'mapping' | 'job';
export interface KnowledgeSettings { pageIds: string[]; agentIds: string[]; workflowIds: string[]; changeWorkflowId: string; memberWrites: boolean }
export interface KnowledgeStoreInput { name: string; kind: KnowledgeKind; provider: 'managed' | 'rest'; endpoint: string; active: boolean; settings: KnowledgeSettings }
export interface Evidence { documentId: string; version: number; quote: string }
export interface KnowledgeRecordInput { kind: KnowledgeRecordKind; name: string; body: Record<string, unknown> }
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.'); return value as Record<string, unknown>;
};
export function knowledgeText(value: unknown, max: number, required = false): string {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > max || required && !value.trim()) throw new Error(`Expected ${required ? 'nonempty ' : ''}text of at most ${max} characters.`);
  return value;
}
function list(value: unknown, max = 100): unknown[] { if (value === undefined) return []; if (!Array.isArray(value) || value.length > max) throw new Error(`Expected at most ${max} entries.`); return value; }
function ids(value: unknown, uuid = false): string[] { return [...new Set(list(value).map((id) => uuid ? studioUuid(id) : knowledgeText(id, 200, true)))]; }
export function validateKnowledgeStore(raw: unknown): KnowledgeStoreInput {
  const value = object(raw); const settings = object(value.settings || {});
  if (!['rag', 'knowledge_graph', 'vector'].includes(String(value.kind))) throw new Error('Invalid knowledge store kind.');
  if (!['managed', 'rest'].includes(String(value.provider))) throw new Error('Invalid knowledge provider.');
  if (value.kind === 'vector' && value.provider !== 'rest') throw new Error('Vector stores require a REST adapter.');
  const endpoint = knowledgeText(value.endpoint, 2000);
  if (value.provider === 'rest') { const url = new URL(endpoint); if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw new Error('REST endpoints require HTTPS without credentials, fragments or query parameters.'); }
  const workflowIds = ids(settings.workflowIds);
  const changeWorkflowId = knowledgeText(settings.changeWorkflowId, 200);
  if (changeWorkflowId && !workflowIds.includes(changeWorkflowId)) throw new Error('The document-change workflow must be assigned to this store.');
  return { name: knowledgeText(value.name, 160, true), kind: value.kind as KnowledgeKind, provider: value.provider as 'managed' | 'rest', endpoint: value.provider === 'rest' ? endpoint : '', active: value.active === true,
    settings: { pageIds: ids(settings.pageIds, true), agentIds: ids(settings.agentIds), workflowIds, changeWorkflowId, memberWrites: settings.memberWrites === true } };
}
export function validateKnowledgeRecord(raw: unknown): KnowledgeRecordInput {
  const value = object(raw); const source = object(value.body || {}); let body: Record<string, unknown>;
  const kind = value.kind as KnowledgeRecordKind;
  if (kind === 'document') {
    const url = knowledgeText(source.url, 2000); if (url && !['https:', 'http:'].includes(new URL(url).protocol)) throw new Error('Document source URLs must use HTTP(S).');
    body = { text: knowledgeText(source.text, 400000, true), url, documentType: knowledgeText(source.documentType, 100) || 'document' };
  } else if (kind === 'skill') {
    const evidence = list(source.evidence, 50).map((raw) => { const row = object(raw); if (!Number.isInteger(row.version) || Number(row.version) < 1) throw new Error('Evidence needs a positive document revision.'); return { documentId: studioUuid(row.documentId), version: row.version, quote: knowledgeText(row.quote, 8000, true) }; });
    if (!evidence.length) throw new Error('Skills require at least one source evidence citation.');
    body = { description: knowledgeText(source.description, 10000), framework: knowledgeText(source.framework, 200), category: knowledgeText(source.category, 200), level: knowledgeText(source.level, 200), evidence };
  } else if (kind === 'mapping') {
    body = { skillId: studioUuid(source.skillId), framework: knowledgeText(source.framework, 200, true), category: knowledgeText(source.category, 200, true), level: knowledgeText(source.level, 200, true) };
  } else if (kind === 'job') {
    const requirements = list(source.requirements).map((raw) => { const row = object(raw); return { skillId: studioUuid(row.skillId), level: knowledgeText(row.level, 200, true), category: knowledgeText(row.category, 200) }; });
    if (!requirements.length) throw new Error('Job profiles require at least one skill.');
    body = { description: knowledgeText(source.description, 20000, true), requirements };
  } else throw new Error('Invalid skill record kind.');
  return { kind, name: knowledgeText(value.name, 200, true), body };
}
export function chunkKnowledgeText(text: string): string[] {
  const chunks: string[] = []; for (let i = 0; i < text.length; i += 1600) chunks.push(text.slice(i, i + 1800)); return chunks;
}
export function parseKnowledgeWorkflowOutput(output: unknown): KnowledgeRecordInput[] {
  const decoded = typeof output === 'string' ? JSON.parse(output.replace(/^```(?:json)?\s*|\s*```$/g, '')) : output;
  const records = list(object(decoded).records, 100);
  if (!records.length) throw new Error('Workflow output must contain a nonempty records array.');
  return records.map(validateKnowledgeRecord);
}
