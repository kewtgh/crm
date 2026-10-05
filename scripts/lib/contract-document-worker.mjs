import {readRegisteredTemplate} from "../../lib/contract-document-files.mjs";
import {digest,docxMime,productionEligibility,renderDocx,resolveDocumentFields} from "../../lib/contract-document-engine.mjs";
import {openDocumentConfiguration} from "../../lib/contract-document-configuration.mjs";
export async function processContractDocument(job,request,store) {
  let key;
  try {
    const erasure=await request("/db/rpc/document_erasure_input",{method:"POST",body:JSON.stringify({job_id:job.id,token:job.lease_token})});
    if(erasure){for(const old of erasure.keys)await store.delete(old);await request("/db/rpc/finish_document_erasure",{method:"POST",body:JSON.stringify({job_id:job.id,token:job.lease_token})});return {id:erasure.id,erased:true};}
    const input=await request("/db/rpc/document_worker_input",{method:"POST",body:JSON.stringify({job_id:job.id,token:job.lease_token})});
    const {document:d,template:t,configuration:cfg}=input;
    const version={...t.definition,status:t.status,approved_by:t.approved_by,approved_at:t.approved_at};
    const bytes=await readRegisteredTemplate(version);
    const resolved=resolveDocumentFields(version,d.input_snapshot.context,d.input_snapshot.confirmed,openDocumentConfiguration(cfg.encrypted_values),
      {id:d.created_by,at:d.input_snapshot.confirmedAt,configurationId:cfg.id,configurationApprovedBy:cfg.approved_by,configurationApprovedAt:cfg.approved_at});
    productionEligibility(version,t.active?t.version_number:null,resolved.issues);
    const content=renderDocx(version,bytes,resolved.values);
    key=await request("/db/rpc/reserve_document_artifact",{method:"POST",body:JSON.stringify({job_id:job.id,token:job.lease_token})});
    for(const prior of d.artifact_attempts??[])if(prior!==key)await store.delete(prior);
    await store.put(key,content,{contentType:docxMime,checksum:digest(content)});
    await request("/db/rpc/complete_contract_document",{method:"POST",body:JSON.stringify({job_id:job.id,token:job.lease_token,artifact_sha:digest(content),artifact_bytes:content.length,field_evidence:JSON.stringify(resolved.evidence)})});
    return {id:d.id,key,sha256:digest(content)};
  } catch(error) {
    // Completion may have succeeded before an ambiguous network error. Reconcile before deletion.
    if(key) {
      const row=await request("/db/rpc/document_attempt_status",{method:"POST",body:JSON.stringify({job_id:job.id,token:job.lease_token})}).catch(()=>null);
      if(row?.status==="GENERATED"&&row.artifact_key===key)return {id:row.id,key,reconciled:true};
      if(row)await store.delete(key).catch(()=>{});
    }
    await request("/db/rpc/fail_contract_document",{method:"POST",body:JSON.stringify({job_id:job.id,token:job.lease_token})}).catch(()=>{});
    throw error;
  }
}
