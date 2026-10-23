import {sha256} from "../../deploy/libexec/lumina-host-contract.mjs";
import {assertEarlyRequestRecoverable} from "./deployment-recovery.mjs";
import {validateEarlyRejection} from "./controller-entry.mjs";

export function assertNoIncompleteEarlyArchive(ledgers){if(ledgers.some(value=>!value||value.schemaVersion!==1||value.stage!=="ARCHIVED"||value.archiveVerified!==true))throw new Error("EARLY_ARCHIVE_FINALIZATION_REQUIRED");}

export function earlyArchivePlan({request,latest,bootstrap,receipt,records=[],serviceActive=false}){
 if(serviceActive||!request||latest?.requestId!==request.requestId||latest.mode!==request.mode||bootstrap?.requestId!==request.requestId||bootstrap.launchId!==request.launchId||bootstrap.result!==latest.result||bootstrap.attempts?.at(-1)?.attemptId!==latest.attempts?.at(-1)?.attemptId)throw new Error("EARLY_ARCHIVE_IDENTITY_CONFLICT");
 for(const value of [latest,bootstrap])if(value.applicationResult!=="NOT_STARTED"||value.migrationMayHaveChanged!==false||value.migrationState!=="NOT_STARTED"||value.webSwitch!=="NOT_STARTED"||value.workerSwitch!=="NOT_STARTED"||value.applicationAccepted!==false||value.finalizationComplete!==false||value.requestArchived!==false)throw new Error("EARLY_ARCHIVE_EVIDENCE_INCOMPLETE");
 for(const record of [latest,bootstrap,...records.filter(value=>value?.requestId===request.requestId)]){
  if(record?.outcome==="ADMITTED"||record?.deploymentId||record?.applicationAccepted===true||record?.migrationMayHaveChanged===true||record?.migrationState&&record.migrationState!=="NOT_STARTED"||record?.webSwitch&&record.webSwitch!=="NOT_STARTED"||record?.workerSwitch&&record.workerSwitch!=="NOT_STARTED"||record?.result==="CONTROL_PLANE_FINALIZATION_FAILED")throw new Error("EARLY_ARCHIVE_BUSINESS_EFFECTS_OR_AMBIGUITY");
  if(record?.controllerStarted===true&&(record.result!=="CONTROLLER_REJECTED"||record.attempts?.at(-1)?.attemptId!==latest.attempts.at(-1).attemptId))throw new Error("EARLY_ARCHIVE_PRIOR_HANDOFF_AMBIGUOUS");
 }
 if(latest.controllerStarted===false){assertEarlyRequestRecoverable({request,latest,mode:request.mode});assertEarlyRequestRecoverable({request,latest:bootstrap,mode:request.mode});}
 else{
  if(latest.result!=="CONTROLLER_REJECTED"||latest.controllerExitCode!==1||bootstrap.controllerExitCode!==1||latest.applicationResult!=="NOT_STARTED"||bootstrap.applicationResult!=="NOT_STARTED")throw new Error("EARLY_ARCHIVE_CONTROLLER_UNVERIFIED");
  const identity={requestId:request.requestId,launchId:request.launchId,mode:request.mode,attemptId:latest.attempts.at(-1).attemptId,nonce:latest.handoffNonce,targetCommit:latest.targetCommit};
  if(bootstrap.handoffNonce!==identity.nonce||bootstrap.targetCommit!==identity.targetCommit||JSON.stringify(bootstrap.earlyRejection)!==JSON.stringify(latest.earlyRejection))throw new Error("EARLY_ARCHIVE_IDENTITY_CONFLICT");
  validateEarlyRejection(receipt,identity);if(sha256(JSON.stringify(receipt))!==latest.earlyRejection?.sha256)throw new Error("EARLY_ARCHIVE_RECEIPT_CHANGED");
  if(!Number.isSafeInteger(receipt.controllerPid)||receipt.controllerPid<1||receipt.controllerPid!==latest.controllerPid||receipt.controllerPid!==bootstrap.controllerPid)throw new Error("EARLY_ARCHIVE_CONTROLLER_IDENTITY_INVALID");
 }
 const body={schemaVersion:1,requestId:request.requestId,launchId:request.launchId??null,mode:request.mode,requestSha256:sha256(JSON.stringify(request)),evidenceSha256:sha256(JSON.stringify({latest,bootstrap,receipt:receipt??null,records}))};
 return{...body,approvalSha256:sha256(JSON.stringify(body))};
}
export async function archiveEarlyRequest({plan,approval,operations}){
 if(approval!==plan.approvalSha256)throw new Error("EARLY_ARCHIVE_APPROVAL_REQUIRED");
 return operations.exclusive(async()=>{
  const evidence=await operations.evidence(),fresh=earlyArchivePlan(evidence);
  if(JSON.stringify(fresh)!==JSON.stringify(plan))throw new Error("EARLY_ARCHIVE_EVIDENCE_CHANGED");
  let ledger=await operations.readLedger();if(ledger&&(ledger.plan.approvalSha256!==approval||!['APPROVED','ARCHIVE_INTENT','ARCHIVED'].includes(ledger.stage)))throw new Error("EARLY_ARCHIVE_LEDGER_CONFLICT");
  if(ledger?.stage==="ARCHIVED")return ledger;
  ledger??={schemaVersion:1,plan,request:evidence.request,stage:"APPROVED",events:[]};
  const save=async stage=>{ledger={...ledger,stage,events:[...ledger.events,{stage,at:new Date().toISOString()}]};await operations.persist(ledger);};
  if(!ledger.events.length)await save("APPROVED");
  await save("ARCHIVE_INTENT");await operations.renameOnce(evidence.request);await save("ARCHIVED");return ledger;
 });
}
