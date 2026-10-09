import { adminClient } from '../../supabase/functions/_shared/workflowAccess.ts';
import { processKnowledgeJob } from './processor.ts';
const admin=adminClient();let stopping=false;
Deno.addSignalListener('SIGTERM',()=>{stopping=true;});Deno.addSignalListener('SIGINT',()=>{stopping=true;});
console.info('Knowledge job dispatcher started.');
while(!stopping){
 try{const {data,error}=await admin.rpc('claim_knowledge_job');if(error)throw error;if(data){await processKnowledgeJob(admin,data);continue;}}
 catch{console.error('Knowledge queue unavailable; retrying.');}
 await new Promise((resolve)=>setTimeout(resolve,2000));
}
