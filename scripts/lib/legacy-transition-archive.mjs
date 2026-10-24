import {HOST_COMPATIBILITY,sha256} from "../../deploy/libexec/lumina-host-contract.mjs";

const digest=value=>sha256(JSON.stringify(value));
const deploymentUnit="lumina-crm-deploy.service";
const scalar=value=>typeof value==="string"?value:typeof value==="number"&&Number.isSafeInteger(value)?String(value):null;
export function journalTimestampUs(value){
 const text=scalar(value);return typeof text==="string"&&/^[1-9]\d{0,19}$/.test(text)?BigInt(text):null;
}
export function deploymentServiceInactive(service){return["inactive","failed"].includes(service?.activeState);}
export function historicalManagerExit(journal){
 if(!/^[0-9a-f]{32}$/.test(journal?.invocationId??"")||!Array.isArray(journal?.entries))return null;
 // Count all manager process-exit candidates for this invocation. A second,
 // contradictory exit must not disappear merely because it reports another status.
 const exits=journal.entries.filter(value=>value&&scalar(value._UID)==="0"&&scalar(value._PID)==="1"&&value.UNIT===deploymentUnit&&value.INVOCATION_ID===journal.invocationId&&(Object.hasOwn(value,"EXIT_CODE")||Object.hasOwn(value,"EXIT_STATUS")));
 if(exits.length!==1)return null;
 const exit=exits[0],timestamp=journalTimestampUs(exit.__REALTIME_TIMESTAMP);
 if(exit.EXIT_CODE!=="exited"||scalar(exit.EXIT_STATUS)!=="1"||timestamp===null||typeof exit.__CURSOR!=="string"||!exit.__CURSOR)return null;
 return{invocationId:journal.invocationId,pid:"1",uid:"0",unit:deploymentUnit,exitCode:"exited",exitStatus:"1",timestampUs:timestamp.toString(),cursor:exit.__CURSOR};
}
export function assertLegacyArchiveComplete(ledger,{requestId,archivedRequest,originalRequest,originalLatest,evidence}){
 const {approvalSha256,...body}=ledger?.plan??{};
 if(ledger?.schemaVersion!==1||ledger.kind!=="LEGACY_TRANSITION_FAILURE"||ledger.stage!=="ARCHIVED"||ledger.events?.at(-1)?.stage!=="ARCHIVED"||body.requestId!==requestId||digest(body)!==approvalSha256||sha256(archivedRequest)!==body.requestSha256||sha256(originalRequest)!==body.requestSha256||sha256(originalLatest)!==body.latestSha256||digest(JSON.parse(evidence))!==body.evidenceSha256)throw new Error("LEGACY_TRANSITION_FINALIZATION_REQUIRED");
}
export function assessLegacyTransition(evidence){
 const missing=[],failed=[],need=(ok,key)=>{if(!ok)missing.push(key);},check=(ok,key)=>{if(!ok)failed.push(key);};
 const {request,latest,bootstrap,accepted,journal,runtime,sourceProof,state}=evidence;
 need(request&&latest&&bootstrap,"original-request-latest-bootstrap");need(accepted,"last-accepted-release");need(journal?.rootAttested&&journal.complete,"root-attested-complete-systemd-invocation");need(sourceProof,"audited-source-order-proof");need(runtime?.isolated,"CRM-rootless-runtime-observation");need(state?.inventoryComplete,"complete-deployment-journal-and-log-inventory");
 if(missing.length)return{eligible:false,missing,failed};
 check(request.sourceRoot==="/opt/lumina-crm/source"&&["deploy","initialize","rollback","recover"].includes(request.mode)&&request.handoffProtocol===undefined&&/^[0-9a-f-]{36}$/.test(request.requestId??"")&&/^[0-9a-f-]{36}$/.test(request.launchId??""),"original-legacy-request-contract");
 check(HOST_COMPATIBILITY.legacyBootstrapSources.includes(latest.bootstrapCommit),"unapproved-bootstrap-source");
 check(HOST_COMPATIBILITY.legacyEntryFailureTargets.includes(latest.targetCommit),"unapproved-transition-failure-target");
 const old=HOST_COMPATIBILITY.revisions[latest.bootstrapCommit],target=HOST_COMPATIBILITY.revisions[latest.targetCommit];
 check(sourceProof.bootstrap===old?.files["scripts/deploy-production-bootstrap.mjs"]&&sourceProof.runner===target?.files["scripts/deploy-production-runner.mjs"]&&sourceProof.entry===target?.files["scripts/lib/controller-entry.mjs"]&&sourceProof.guardBeforeBusiness===true,"source-order-not-proven");
 check(request.requestId===latest.requestId&&request.launchId===latest.launchId&&request.mode===latest.mode&&bootstrap.requestId===request.requestId&&JSON.stringify(bootstrap)===JSON.stringify(latest),"request-bootstrap-latest-identity");
 check(latest.result==="BOOTSTRAP_FAILED"&&latest.stage==="target-controller-exit"&&latest.error==="TARGET_CONTROLLER_EXIT_FAILED"&&latest.controllerStarted===true&&latest.recoverySafe===false&&!latest.earlyRejection,"not-a-legacy-entry-transition-failure");
 check(latest.deploymentId===null&&latest.applicationResult==="NOT_STARTED"&&latest.migrationState==="NOT_STARTED"&&latest.migrationMayHaveChanged===false&&latest.webSwitch==="NOT_STARTED"&&latest.workerSwitch==="NOT_STARTED"&&latest.applicationAccepted===false&&latest.finalizationComplete===false&&latest.requestArchived===false,"business-effects-or-finalization");
 check(latest.attempts?.filter(value=>value.controllerStarted).length===1&&latest.attempts.at(-1).controllerStarted===true,"unproven-prior-controller-attempt");
 check(state.journals?.length===0&&state.logs?.length===0&&state.admittedEntries?.length===0&&state.conflictingHistory?.length===0,"deployment-journal-log-or-other-execution-present");
 // Current systemctl fields describe the service now, possibly after reset/reboot
 // or another invocation. They can prove quiescence, never this historical exit.
 check(evidence.serviceActive===false&&deploymentServiceInactive(evidence.service),"deployment-service-not-quiescent");
 const entries=Array.isArray(journal.entries)?journal.entries:[],scoped=entries.filter(value=>value&&value._SYSTEMD_INVOCATION_ID===journal.invocationId&&value._SYSTEMD_UNIT===deploymentUnit&&scalar(value._UID)===scalar(runtime.uid));
 check(entries.length>0&&entries.every(value=>value&&typeof value.MESSAGE==="string"&&typeof value.__CURSOR==="string"&&value.__CURSOR&&journalTimestampUs(value.__REALTIME_TIMESTAMP)!==null&&!['line-max','nul'].includes(value._LINE_BREAK))&&new Set(entries.map(value=>value?.__CURSOR)).size===entries.length,"journal-incomplete-or-truncated");
 const lines=scoped.filter(value=>typeof value.MESSAGE==="string").flatMap(value=>value.MESSAGE.split(/\r?\n/)),one=text=>lines.filter(value=>value===text).length===1;
 check(one(`BOOTSTRAP_SOURCE_COMMIT=${latest.bootstrapCommit}`)&&one(`TARGET_SOURCE_COMMIT=${latest.targetCommit}`),"journal-source-identity");
 check(lines.some(value=>value.startsWith("HOST_NODE_VERSION="))&&one("COMPATIBILITY_RESULT=COMPATIBLE")&&one("TARGET_APPLICATION_VERSION=3.40.0"),"bootstrap-entry-and-target-version");
 const pidLines=lines.filter(value=>/^TARGET_CONTROLLER_PID=[1-9]\d*$/.test(value)),childPid=Number(pidLines[0]?.split("=")[1]);check(pidLines.length===1&&Number.isSafeInteger(childPid),"controller-pid-evidence");
 check(lines.some(value=>/^Error: CONTROLLER_ENTRY_IDENTITY_INVALID$/.test(value))&&lines.some(value=>/controllerEntryIdentity .*scripts\/lib\/controller-entry\.mjs:\d+:\d+/.test(value))&&lines.some(value=>/productionControllerEntry .*scripts\/lib\/controller-entry\.mjs:\d+:\d+/.test(value)),"specific-uncaught-entry-failure");
 check(!lines.some(value=>/Accepted persistent request|TARGET_CONTROLLER_REEXEC_OK|apply locked forward migration|SWITCH_STARTED|LUMINA_PRODUCTION_DEPLOY_OK/.test(value)),"business-execution-in-journal");
 const historicalExit=historicalManagerExit(journal);check(Boolean(historicalExit),"trusted-manager-exit-evidence");
 const start=Date.parse(latest.attempts?.at(-1)?.startedAt),startUs=Number.isFinite(start)&&start>=0?BigInt(start)*1000n:null,endUs=historicalExit?BigInt(historicalExit.timestampUs):null;
 // Preserve the existing one-second start tolerance, comparing journal records
 // in integer microseconds. Service output after the manager exit is not proof.
 check(startUs!==null&&endUs!==null&&endUs>=startUs&&scoped.every(value=>{const at=journalTimestampUs(value.__REALTIME_TIMESTAMP);return at!==null&&at>=startUs-1_000_000n&&at<=endUs;}),"invocation-attempt-time-binding");
 check(accepted.requestId!==request.requestId&&accepted.commit===latest.bootstrapCommit&&accepted.version==="3.40.0"&&Date.parse(accepted.acceptedAt)<=start,"accepted-release-identity");
 for(const name of ["web","worker"]){const service=runtime[name];check(service?.image===accepted.currentImage&&service.state==="running"&&service.health==="healthy"&&service.project==="lumina-crm"&&service.revision===accepted.commit&&/^sha256:[0-9a-f]{64}$/.test(service.imageId??"")&&Date.parse(service.createdAt)<start,`${name}-accepted-runtime-or-no-switch-proof`);}
 check(runtime.web?.imageId===runtime.worker?.imageId,"web-worker-image-identity");
 return{eligible:!missing.length&&!failed.length,missing,failed,childPid,historicalExit,profile:"796cc43-to-c164ff1-entry-identity-v2"};
}
export function legacyTransitionPlan(evidence){
 const assessment=assessLegacyTransition(evidence);if(!assessment.eligible)throw Object.assign(new Error("LEGACY_TRANSITION_EVIDENCE_INCOMPLETE"),{assessment});
 const body={schemaVersion:1,kind:"LEGACY_TRANSITION_FAILURE",profile:assessment.profile,requestId:evidence.request.requestId,launchId:evidence.request.launchId,historicalExit:assessment.historicalExit,requestSha256:sha256(evidence.rawRequest),latestSha256:sha256(evidence.rawLatest),evidenceSha256:digest(evidence),toolSha256:evidence.toolSha256};
 return{...body,approvalSha256:digest(body)};
}
export async function archiveLegacyTransition({plan,approval,operations}){
 if(approval!==plan.approvalSha256)throw new Error("LEGACY_TRANSITION_APPROVAL_REQUIRED");
 return operations.exclusive(async()=>{
  const evidence=await operations.collect(),fresh=legacyTransitionPlan(evidence);if(JSON.stringify(fresh)!==JSON.stringify(plan))throw new Error("LEGACY_TRANSITION_EVIDENCE_CHANGED");
  let ledger=await operations.readLedger();if(ledger&&JSON.stringify(ledger.plan)!==JSON.stringify(plan))throw new Error("LEGACY_TRANSITION_LEDGER_CONFLICT");
  if(ledger?.stage==="ARCHIVED"){await operations.verifyArchive(ledger);return ledger;}
  ledger??={schemaVersion:1,kind:"LEGACY_TRANSITION_FAILURE",plan,stage:"APPROVED",events:[]};
  const save=async stage=>{ledger={...ledger,stage,events:[...ledger.events,{stage,at:new Date().toISOString()}]};await operations.persist(ledger);};
  if(!ledger.events.length)await save("APPROVED");
  await operations.saveOriginals(evidence);await save("SNAPSHOTS_SAVED");await save("ARCHIVE_INTENT");
  await operations.renameRequestOnce(evidence);await operations.verifyArchive(ledger);await save("ARCHIVED");return ledger;
 });
}
