import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {digest,docxMime} from '../../lib/contract-document-engine.mjs';

// Disposable release fixtures only; invoked by the existing bounded PostgreSQL harness.
export async function contractDocumentReleaseScenario({client,as,rpc,run,workerEnv,sourceKind,sourceId,sourceRevision,context,artifact,storageRoot,generatedDocumentId}) {
 const tables=['contracts','student_enrollments','payments','refunds','channel_agreements','channel_agreement_versions','channel_commission_rules','commission_accruals','commission_settlements','automation_events','automation_runs'];
 const facts=async()=>{await client.query('reset role');const out={};for(const table of tables)out[table]=(await client.query(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) facts from public.${table} t`)).rows[0].facts;await as();return out;};
 const before=await facts();
 await assert.rejects(rpc('document_generation_context',[sourceKind,sourceId,{}]),/enrollment_not_found|commission_rule_not_found/);
 await client.query('reset role');
 const lineage=(await client.query('select template_id,configuration_id from public.generated_contract_documents where id=$1',[generatedDocumentId])).rows[0];
 await assert.rejects(client.query("update public.contract_document_template_versions set definition=definition||jsonb_build_object('template_sha256',repeat('0',64)) where id=$1",[lineage.template_id]),/document_template_immutable/);
 await assert.rejects(client.query("update public.contract_document_configurations set encrypted_values='{}' where id=$1",[lineage.configuration_id]),/document_template_immutable/);
 await as();
 const record=await rpc('reserve_contract_upload',[sourceKind,sourceId,sourceRevision,context,'signed-reuploaded-generated.docx','DOCX',docxMime,artifact.length,digest(artifact),randomUUID()]);
 assert.notEqual(record.id,generatedDocumentId);
 await mkdir(path.dirname(path.join(storageRoot,record.key)),{recursive:true});await writeFile(path.join(storageRoot,record.key),artifact);
 const runId=await rpc('complete_contract_upload',[record.id]);run(process.execPath,['scripts/process-generated-jobs.mjs'],workerEnv);
 const detail=await rpc('uploaded_document_detail',[record.id,true]);assert.equal(detail.status,'EXTRACTED');assert.equal(detail.runId,runId);assert.ok(detail.chunks.length>0);
 const candidate=detail.candidates.find(c=>c.fieldKey===(sourceKind==='CUSTOMER_CONTRACT'?'buyer.signing_name':'channel.signatory'));
 assert.equal(candidate.confirmationTarget,'DOCUMENT_ONLY');
 const normalized=typeof candidate.normalizedValue==='string'&&candidate.validationState==='VALID'&&candidate.confidenceState!=='AMBIGUOUS'?candidate.normalizedValue:'Synthetic expressly reviewed signing party';
 const decision=normalized===candidate.normalizedValue?'CONFIRMED':'EDITED';
 await rpc('review_uploaded_candidate',[record.id,runId,candidate.candidateKey,decision,JSON.stringify(normalized),detail.revision,detail.currentSourceRevision,randomUUID(),'Release synthetic document-only review']);
 const reviewed=await rpc('uploaded_document_detail',[record.id,true]);assert.equal(reviewed.reviews.length,1);assert.equal(reviewed.candidates.find(c=>c.candidateKey===candidate.candidateKey).rawValue,candidate.rawValue);
 const original=await rpc('uploaded_original_download',[record.id]);assert.equal(original.sha256,digest(artifact));
 const generated=await rpc('contract_document_download',[generatedDocumentId]);assert.equal(generated.sha256,original.sha256);assert.notEqual(generated.id,record.id);
 assert.deepEqual(await facts(),before,'Generation re-upload/review must not mutate canonical facts or Automation');
 const result={status:'PASS',sourceKind,generatedDocumentId,uploadedEvidenceId:record.id,artifactSHA256:digest(artifact),separateIdentity:true,rawPreserved:true,reviewDecision:decision,explicitContextRequired:true,approvedTemplateConfigurationImmutable:true,canonicalApplyFields:0,domainFactsUnchanged:tables};
 await mkdir('work/v324-release/postgres',{recursive:true});await writeFile(`work/v324-release/postgres/${sourceKind.toLowerCase()}-golden.json`,JSON.stringify(result,null,2)+'\n');
}
