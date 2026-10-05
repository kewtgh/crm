import {parseContractEvidence} from '../../lib/contract-extraction-parser.mjs';
import {verifyDocumentArtifact,DocumentError} from '../../lib/contract-document-engine.mjs';
export async function processContractExtraction(job,request,store){
 const rpc=(name,args)=>request(`/db/rpc/${name}`,{method:'POST',body:JSON.stringify({job_id:job.id,token:job.lease_token,...args})});
 try{
  const input=await rpc('upload_extraction_input',{});
  if(input.erase){await store.delete(input.key);await rpc('complete_upload_extraction',{result:JSON.stringify({})});return {erased:true};}
  const bytes=await store.get(input.key);
  if(!bytes||!verifyDocumentArtifact(bytes,input))throw new DocumentError('UPLOAD_ARTIFACT_INTEGRITY_FAILED');
  const result=await parseContractEvidence(bytes,input.format,input.fields,input.kind);
  await rpc('complete_upload_extraction',{result:JSON.stringify(result)});
  return {id:input.id,runId:input.runId};
 }catch(error){await rpc('fail_upload_extraction',{error_code:error.code??'EXTRACTION_FAILED'}).catch(()=>{});throw error;}
}
