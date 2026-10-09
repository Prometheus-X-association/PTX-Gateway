import { adminClient } from './workflowAccess.ts';
import { decryptForOrganization, HttpError } from './workflowSecurity.ts';
import { assertPublicUrl } from './workflowHttp.ts';
import { knowledgeText, type KnowledgeSettings } from './knowledgeSchema.ts';
export interface KnowledgeStore { id: string; organization_id: string; name: string; kind: string; provider: string; endpoint: string; active: boolean; settings: KnowledgeSettings; revision: number; secret_ciphertext?: string; deleted_at?: string }
export async function knowledgeStore(admin: ReturnType<typeof adminClient>, orgId: string, id: string, requireActive = true): Promise<KnowledgeStore> {
 const { data, error } = await admin.from('knowledge_stores').select('*').eq('organization_id',orgId).eq('id',id).is('deleted_at',null).maybeSingle();
 if (error) throw error;
 if (!data || requireActive && !data.active) throw new HttpError(404,'Active knowledge store not found.');
 return data as KnowledgeStore;
}
export async function validateKnowledgeEndpoint(endpoint: string) {
 const url = new URL(endpoint); if (url.protocol !== 'https:') throw new Error('Knowledge connectors require HTTPS.');
 await assertPublicUrl(url);
 const resolved = await Promise.allSettled([Deno.resolveDns(url.hostname,'A'),Deno.resolveDns(url.hostname,'AAAA')]);
 if (!resolved.some((item) => item.status === 'fulfilled' && item.value.length)) throw new Error('Knowledge endpoint DNS could not be verified.');
 const allowed = (Deno.env.get('KNOWLEDGE_REST_ALLOWED_HOSTS') || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
 if (!allowed.includes(url.hostname.toLowerCase())) throw new Error('Knowledge endpoint must be listed in KNOWLEDGE_REST_ALLOWED_HOSTS.');
}
export async function retrieveKnowledge(admin: ReturnType<typeof adminClient>, store: KnowledgeStore, query: string, limit = 8) {
 knowledgeText(query,4000,true); limit=Math.max(1,Math.min(20,Math.floor(limit)||8));
 if (store.provider === 'managed') {
  const { data,error } = await admin.rpc('knowledge_search',{p_org:store.organization_id,p_store:store.id,p_query:query,p_limit:limit}); if(error) throw error; return data || [];
 }
 await validateKnowledgeEndpoint(store.endpoint);
 const credentials = store.secret_ciphertext ? await decryptForOrganization(admin,store.organization_id,store.secret_ciphertext) : {};
 const response = await fetch(store.endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',...(credentials.token ? {Authorization:`Bearer ${credentials.token}`} : {})},body:JSON.stringify({action:'query',query,limit,storeId:store.id})});
 if(!response.ok) throw new HttpError(502,`Knowledge connector returned HTTP ${response.status}.`);
 const reader=response.body?.getReader(); let raw='';let bytes=0;const decoder=new TextDecoder();
 if(reader) { try { while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>512000)throw new Error('Knowledge response exceeds 500 KiB.');raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{await reader.cancel();} }
 const parsed=JSON.parse(raw);if(!Array.isArray(parsed.matches))throw new Error('Knowledge adapter must return a matches array.');
 return parsed.matches.slice(0,limit).map((row: Record<string,unknown>)=>({content:knowledgeText(row.content,12000,true),sourceId:knowledgeText(row.sourceId,500,true),url:knowledgeText(row.url,2000),score:typeof row.score==='number'&&Number.isFinite(row.score)?row.score:null,external:true}));
}
