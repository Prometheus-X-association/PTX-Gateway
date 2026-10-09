import { supabase } from '@/integrations/supabase/client';
export type { KnowledgeStoreInput, KnowledgeSettings, KnowledgeRecordInput, KnowledgeRecordKind } from '../../supabase/functions/_shared/knowledgeSchema';
import type { KnowledgeStoreInput, KnowledgeRecordInput } from '../../supabase/functions/_shared/knowledgeSchema';
export interface KnowledgeStore extends KnowledgeStoreInput { id:string; organization_id:string; revision:number; credentialConfigured:boolean }
export interface KnowledgeRecord extends KnowledgeRecordInput { id:string; revision:number; updated_at:string; updated_by:string }
export interface KnowledgeJob { id:string; workflow_id:string; status:string; run_id?:string; error?:string; created_at:string }
export interface KnowledgeVersion { id:string; record_id:string; revision:number; name:string; body:Record<string,unknown>; actor_id:string; workflow_run_id?:string; workflow_context?:{workflowId?:string;workflowName?:string}; created_at:string; deleted:boolean }
export interface KnowledgeEdge { source_id:string; target_id:string; relation:string; target_revision:number; detail:Record<string,unknown> }
export interface KnowledgeResponse { ok:boolean; stores?:KnowledgeStore[]; store?:KnowledgeStore; records?:KnowledgeRecord[]; jobs?:KnowledgeJob[]; edges?:KnowledgeEdge[]; nodes?:Array<{id:string;name:string;kind:string;revision:number;deleted_at?:string}>; versions?:KnowledgeVersion[]; canWrite?:boolean; nextOffset?:number|null; isAdmin?:boolean; organizationId?:string; matches?:Array<{content:string;documentId?:string;sourceId?:string;revision?:number;url?:string;score?:number}>; slug?:string }
export async function knowledgeApi(action:string,organizationId?:string,body:Record<string,unknown>={}):Promise<KnowledgeResponse>{
 const {data,error}=await supabase.functions.invoke('knowledge-api',{headers:organizationId?{'x-organization-id':organizationId}:undefined,body:{...body,action}});
 if(error){const detail=await error.context?.json?.().catch(()=>null);throw new Error(detail?.error||error.message);}if(!data?.ok)throw new Error(data?.error||'Knowledge request failed.');return data;
}
export const newKnowledgeStore=():KnowledgeStoreInput=>({name:'',kind:'knowledge_graph',provider:'managed',endpoint:'',active:true,settings:{pageIds:[],agentIds:[],workflowIds:[],changeWorkflowId:'',memberWrites:false}});
