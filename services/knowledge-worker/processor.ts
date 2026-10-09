import { adminClient } from '../../supabase/functions/_shared/workflowAccess.ts';
import { knowledgeStore } from '../../supabase/functions/_shared/knowledgeRetrieval.ts';
import { createRun } from '../../supabase/functions/_shared/workflowRuns.ts';
import { parseKnowledgeWorkflowOutput } from '../../supabase/functions/_shared/knowledgeSchema.ts';
export async function processKnowledgeJob(admin: ReturnType<typeof adminClient>, job: {id:string;organization_id:string;store_id:string;actor_id:string;workflow_id:string;input:Record<string,unknown>;run_id?:string;lease_token:string}) {
 const patch = async (value:Record<string,unknown>) => {
  const {error}=await admin.from('knowledge_jobs').update({...value,lease_token:null,lease_until:null,updated_at:new Date().toISOString()}).eq('id',job.id).eq('lease_token',job.lease_token);if(error)throw error;
 };
 try {
  const store=await knowledgeStore(admin,job.organization_id,job.store_id);
  const member=await admin.from('organization_members').select('user_id').eq('organization_id',job.organization_id).eq('user_id',job.actor_id).eq('status','active').maybeSingle();if(member.error)throw member.error;if(!member.data)throw new Error('The initiating organization member is no longer active.');
  const org=await admin.from('organizations').select('id').eq('id',job.organization_id).eq('is_active',true).maybeSingle();if(org.error)throw org.error;if(!org.data)throw new Error('Organization is inactive.');
  if(!store.settings.workflowIds.includes(job.workflow_id))throw new Error('Workflow is no longer assigned to this knowledge store.');
  let runId=job.run_id;
  if(!runId){const started=await createRun(admin,{orgId:job.organization_id,callerId:`user:${job.actor_id}`,userId:job.actor_id,isAdmin:false},{workflowId:job.workflow_id,input:{...job.input,knowledgeStoreId:store.id,knowledgeJobId:job.id},userMessage:'Build knowledge records. Return JSON {"records":[{"kind":"skill|mapping|job|document","name":"...","body":{...}}]}. Skills must quote real supplied document text and cite documentId and document revision. Do not invent evidence.'},'api',`knowledge:${job.id}`);runId=started.runId;}
  const {data:run,error}=await admin.from('workflow_runs').select('status,output').eq('id',runId).eq('organization_id',job.organization_id).maybeSingle();if(error)throw error;if(!run)throw new Error('Knowledge workflow run not found.');
  if(run.status==='succeeded'){parseKnowledgeWorkflowOutput(run.output);await patch({run_id:runId,status:'review',error:null});}
  else if(['failed','cancelled','timed_out','incomplete'].includes(run.status))await patch({run_id:runId,status:'failed',error:`Workflow ${run.status}. Inspect the run in Agent Orchestration.`});
  else await patch({run_id:runId,status:'running',available_at:new Date(Date.now()+5000).toISOString(),error:null});
 }catch(error){console.error('Knowledge job failed',job.id);await patch({status:'failed',error:error instanceof Error?error.message.slice(0,500):'Knowledge job failed.'});}
}
