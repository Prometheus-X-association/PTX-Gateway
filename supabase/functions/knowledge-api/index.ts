import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { adminClient, authorize, authenticatedWorkerRun, loadWorkflow, checkWorkflowAccess } from '../_shared/workflowAccess.ts';
import { cors, readBody } from '../_shared/workflowRuns.ts';
import { encryptForOrganization, HttpError, object } from '../_shared/workflowSecurity.ts';
import { studioUuid } from '../_shared/studioSchema.ts';
import { knowledgeText, validateKnowledgeStore, validateKnowledgeRecord, parseKnowledgeWorkflowOutput } from '../_shared/knowledgeSchema.ts';
import { knowledgeStore, retrieveKnowledge, validateKnowledgeEndpoint } from '../_shared/knowledgeRetrieval.ts';
const headers = {...cors,'Access-Control-Allow-Headers':`${cors['Access-Control-Allow-Headers']}, x-client-info, x-workflow-run-id, x-workflow-lease, x-workflow-signature, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version`,'Content-Type':'application/json','Cache-Control':'no-store'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const cleanStore=(row: Record<string,unknown>)=>{const {secret_ciphertext,...safe}=row;return {...safe,credentialConfigured:Boolean(secret_ciphertext)};};
export async function handleKnowledgeRequest(req:Request) {
 if(req.method==='OPTIONS')return new Response(null,{headers});
 try {
  if(req.method!=='POST')throw new HttpError(405,'Use POST.');
  const body=object(JSON.parse(String(await readBody(req,1024*1024))||'{}'));const admin=adminClient();const action=String(body.action||'list');
  let orgId=req.headers.get('x-organization-id')||body.organizationId;
  if(body.orgSlug){const {data,error}=await admin.from('organizations').select('id').eq('slug',String(body.orgSlug)).eq('is_active',true).maybeSingle();if(error)throw error;if(!data)throw new HttpError(404,'Organization not found.');if(orgId&&orgId!==data.id)throw new HttpError(403,'Organization mismatch.');orgId=data.id;}
  const worker=await authenticatedWorkerRun(req,admin);
  const principal=worker?{orgId:worker.organization_id,callerId:worker.caller_id,isAdmin:false,workflowIds:[worker.workflow_id],userId:undefined,keyId:undefined,publicToken:false}:await authorize(req,{organizationId:orgId},admin);
  const org=await admin.from('organizations').select('id').eq('id',principal.orgId).eq('is_active',true).maybeSingle();if(org.error)throw org.error;if(!org.data)throw new HttpError(403,'Organization inactive.');
  if(principal.publicToken)throw new HttpError(403,'Knowledge access requires organization membership or an assigned workflow credential.');
  if(!principal.userId&&!worker&&!principal.keyId)throw new HttpError(403,'Knowledge credentials required.');
  if((worker||principal.keyId)&&action!=='query')throw new HttpError(403,'Workflow credentials support assigned knowledge queries only.');
  if(action==='list'){
   let query=admin.from('knowledge_stores').select('*').eq('organization_id',principal.orgId).is('deleted_at',null).order('name');if(!principal.isAdmin)query=query.eq('active',true);
   const {data,error}=await query.limit(200);if(error)throw error;return json({ok:true,stores:(data||[]).map(cleanStore),isAdmin:principal.isAdmin,organizationId:principal.orgId});
  }
  if(action==='create_store'||action==='save_store'){
   if(!principal.isAdmin)throw new HttpError(403,'Organization administrator required.');
   const data=validateKnowledgeStore(body.store);
   if(data.provider==='rest')await validateKnowledgeEndpoint(data.endpoint);
   for(const id of data.settings.pageIds){const page=await admin.from('studio_items').select('id').eq('organization_id',principal.orgId).eq('id',id).eq('kind','page').is('deleted_at',null).maybeSingle();if(page.error)throw page.error;if(!page.data)throw new HttpError(400,'Assigned page not found in this organization.');}
   for(const id of data.settings.workflowIds)await loadWorkflow(admin,principal.orgId,id);
   if(data.settings.agentIds.length){const config=await admin.from('global_configs').select('features').eq('organization_id',principal.orgId).maybeSingle();if(config.error)throw config.error;const agents=object(object(config.data?.features).llmInsights).agents||[];if(data.settings.agentIds.some((id)=>!agents.some((agent:{id:string;enabled?:boolean;deletedAt?:string})=>agent.id===id&&agent.enabled!==false&&!agent.deletedAt)))throw new HttpError(400,'Assigned agent unavailable.');}
   if(action==='save_store'){
    const previous=await knowledgeStore(admin,principal.orgId,studioUuid(body.storeId),false);
    if(previous.endpoint!==data.endpoint && previous.secret_ciphertext && data.provider==='rest' && !body.token && body.clearSecret!==true)throw new HttpError(400,'Replace or clear the connector credential when changing its endpoint.');
   }
   const token=knowledgeText(body.token,8000);const secret=token?await encryptForOrganization(admin,principal.orgId,{token}):null;
   const result=await admin.rpc('knowledge_mutate',{p_org:principal.orgId,p_actor:principal.userId,p_action:action,p_store:action==='create_store'?null:studioUuid(body.storeId),p_expected:body.expectedRevision,p_data:{...data,clearSecret:body.clearSecret===true},p_secret:secret});
   if(result.error)throw result.error;return json({ok:true,store:result.data});
  }
  const store=await knowledgeStore(admin,principal.orgId,studioUuid(body.storeId),!principal.isAdmin);
  if(body.pageId){if(!store.settings.pageIds.includes(studioUuid(body.pageId)))throw new HttpError(403,'Knowledge store is not assigned to this page.');}
  if(action==='query'){
   if(!store.active)throw new HttpError(403,'Knowledge store is inactive.');
   if(worker||principal.keyId){const id=worker?worker.workflow_id:knowledgeText(body.workflowId,200,true);checkWorkflowAccess(principal,id);if(!store.settings.workflowIds.includes(id))throw new HttpError(403,'Workflow is not assigned to this store.');await loadWorkflow(admin,principal.orgId,id);}
   const matches=await retrieveKnowledge(admin,store,knowledgeText(body.query,4000,true),Number(body.limit)||8);return json({ok:true,matches});
  }
  if(action==='snapshot'){
   const offset=Math.max(0,Math.floor(Number(body.offset)||0));if(offset>100000)throw new HttpError(400,'Offset exceeds limit.');
   let records=admin.from('knowledge_records').select('*').eq('organization_id',principal.orgId).eq('store_id',store.id).is('deleted_at',null).order('updated_at',{ascending:false});
   if(body.kind){if(!['document','skill','mapping','job'].includes(String(body.kind)))throw new HttpError(400,'Invalid record kind.');records=records.eq('kind',body.kind);}
   const [rows,jobs,edges]=await Promise.all([records.range(offset,offset+99),admin.from('knowledge_jobs').select('id,workflow_id,status,run_id,error,created_at,updated_at,actor_id').eq('organization_id',principal.orgId).eq('store_id',store.id).order('created_at',{ascending:false}).limit(50),admin.from('knowledge_edges').select('*').eq('organization_id',principal.orgId).eq('store_id',store.id).limit(1000)]);
   for(const result of [rows,jobs,edges])if(result.error)throw result.error;
   return json({ok:true,store:cleanStore(store as unknown as Record<string,unknown>),records:rows.data||[],jobs:jobs.data||[],edges:edges.data||[],canWrite:store.active&&(principal.isAdmin||store.settings.memberWrites),nextOffset:rows.data?.length===100?offset+100:null});
  }
  if(action==='graph'){
   const [nodes,edges]=await Promise.all([admin.from('knowledge_records').select('id,name,kind,revision,deleted_at').eq('organization_id',principal.orgId).eq('store_id',store.id).limit(500),admin.from('knowledge_edges').select('*').eq('organization_id',principal.orgId).eq('store_id',store.id).limit(1000)]);if(nodes.error)throw nodes.error;if(edges.error)throw edges.error;return json({ok:true,nodes:nodes.data||[],edges:edges.data||[]});
  }
  if(action==='review_job'){
   const job=await admin.from('knowledge_jobs').select('run_id,status').eq('organization_id',principal.orgId).eq('store_id',store.id).eq('id',studioUuid(body.id)).maybeSingle();if(job.error)throw job.error;if(!job.data||!['review','succeeded'].includes(job.data.status))throw new HttpError(409,'Job is not ready for review.');
   const run=await admin.from('workflow_runs').select('output,status').eq('organization_id',principal.orgId).eq('id',job.data.run_id).maybeSingle();if(run.error)throw run.error;if(run.data?.status!=='succeeded')throw new HttpError(409,'Run is unavailable.');return json({ok:true,records:parseKnowledgeWorkflowOutput(run.data.output)});
  }
  if(action==='history'){
   const {data,error}=await admin.from('knowledge_versions').select('*').eq('organization_id',principal.orgId).eq('store_id',store.id).eq('record_id',studioUuid(body.id)).order('revision',{ascending:false}).limit(100);if(error)throw error;return json({ok:true,versions:data||[]});
  }
  if(!principal.isAdmin&&!store.settings.memberWrites)throw new HttpError(403,'Store editing is restricted to administrators.');
  if(!store.active&&!['delete_store','create_skill_app'].includes(action))throw new HttpError(403,'Activate the store before editing records.');
  if(action==='create_skill_app'){
   if(!principal.isAdmin)throw new HttpError(403,'Organization administrator required.');
   const result=await admin.rpc('knowledge_create_skill_app',{p_org:principal.orgId,p_actor:principal.userId,p_store:store.id});if(result.error)throw result.error;return json({ok:true,...result.data});
  }
  let data:unknown={};const id=body.id?studioUuid(body.id):null;
  if(action==='save_record')data=validateKnowledgeRecord(body.record);
  else if(action==='queue'){
   const workflowId=knowledgeText(body.workflowId,200,true);await loadWorkflow(admin,principal.orgId,workflowId);
   data={workflowId,input:object(body.input||{})};
  }else if(action==='apply_job'){
   const job=await admin.from('knowledge_jobs').select('*').eq('organization_id',principal.orgId).eq('store_id',store.id).eq('id',id).maybeSingle();if(job.error)throw job.error;if(!job.data)throw new HttpError(404,'Job not found.');
   if(job.data.status==='succeeded')return json({ok:true,alreadyApplied:true});
   if(job.data.status!=='review')throw new HttpError(409,'Job is not ready for review.');
   const run=await admin.from('workflow_runs').select('output,status,organization_id').eq('id',job.data.run_id).eq('organization_id',principal.orgId).maybeSingle();if(run.error)throw run.error;if(run.data?.status!=='succeeded')throw new HttpError(409,'Workflow has not succeeded.');
   data={records:parseKnowledgeWorkflowOutput(run.data.output)};
  }else if(!['delete_record','delete_store'].includes(action))throw new HttpError(400,'Unknown knowledge action.');
  if(action==='delete_store'&&!principal.isAdmin)throw new HttpError(403,'Organization administrator required.');
  const result=await admin.rpc('knowledge_mutate',{p_org:principal.orgId,p_actor:principal.userId,p_action:action,p_store:store.id,p_id:id,p_expected:body.expectedRevision,p_data:data});
  if(result.error)throw result.error;return json({ok:true,result:result.data});
 }catch(error){const e=error as {status?:number;code?:string;message?:string};return json({ok:false,error:e.message||'Knowledge request failed.'},e.status|| (e.code==='40001'?409:e.code==='42501'?403:400));}
}
serve(handleKnowledgeRequest);
