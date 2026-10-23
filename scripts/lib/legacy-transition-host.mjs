import {spawnSync} from "node:child_process";
import {readFileSync,lstatSync,realpathSync,readdirSync,existsSync,mkdirSync,renameSync,openSync,writeFileSync,closeSync,fsyncSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {HOST_PATHS,HOST_COMPATIBILITY,sha256} from "../../deploy/libexec/lumina-host-contract.mjs";
import {hostLocksHeld} from "../../deploy/libexec/lumina-host-upgrade.mjs";
import {collectHostSnapshot} from "./host-preflight.mjs";
import {assessLegacyTransition,assertLegacyArchiveComplete} from "./legacy-transition-archive.mjs";

export const TRANSITION_EVIDENCE_ROOT="/etc/lumina-crm/transition-evidence";
const unit="lumina-crm-deploy.service";
const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value??"");
export function hostRead(command,args,options={}){
 const result=spawnSync(command,args,{encoding:"utf8",timeout:10000,maxBuffer:8_000_000,windowsHide:true,...options});
 if(result.error||result.status!==0)throw new Error("TRANSITION_OBSERVATION_FAILED");return result.stdout;
}
export function trustedRead(file,uid){
 const meta=lstatSync(file);if(!meta.isFile()||meta.isSymbolicLink()||meta.uid!==uid||(meta.mode&0o022)!==0||realpathSync(file)!==file)throw new Error("TRANSITION_FILE_METADATA_INVALID");
 return readFileSync(file,"utf8");
}
export function durableText(file,text,{exclusive=false}={}){
 const temp=exclusive?file:`${file}.pending-${process.pid}`;
 const fd=openSync(temp,"wx",0o600);try{writeFileSync(fd,text);fsyncSync(fd);}finally{closeSync(fd);}
 if(!exclusive)renameSync(temp,file);
 if(process.platform!=="win32"){const directory=openSync(path.dirname(file),"r");try{fsyncSync(directory);}finally{closeSync(directory);}}
}
export function serviceObservation(run=hostRead){
 const fields=Object.fromEntries(run("/usr/bin/systemctl",["show",unit,"--property=ActiveState,Result,ExecMainStatus,InvocationID","--no-pager"]).trim().split(/\r?\n/).map(line=>{const at=line.indexOf("=");return[line.slice(0,at),line.slice(at+1)];}));
 return{activeState:fields.ActiveState,result:fields.Result,execMainStatus:fields.ExecMainStatus,invocationId:fields.InvocationID};
}
export function captureTransitionJournal(invocationId,toolSha256,{run=hostRead}={}){
 if(!/^[0-9a-f]{32}$/.test(invocationId??""))throw new Error("TRANSITION_INVOCATION_INVALID");
 const entries=new Map();
 // Service stdout credentials can belong to its parent. The manager exit event has
 // UNIT/INVOCATION_ID, rather than the service's trusted _SYSTEMD_INVOCATION_ID.
 for(const filter of [`_SYSTEMD_INVOCATION_ID=${invocationId}`,`INVOCATION_ID=${invocationId}`]){
  const text=run("/usr/bin/journalctl",["--no-pager","--all","--output=json",filter]);
  for(const line of text.trim().split("\n").filter(Boolean)){const entry=JSON.parse(line);if(!entry.__CURSOR)throw new Error("TRANSITION_JOURNAL_CURSOR_MISSING");const prior=entries.get(entry.__CURSOR);if(prior&&JSON.stringify(prior)!==JSON.stringify(entry))throw new Error("TRANSITION_JOURNAL_CONFLICT");entries.set(entry.__CURSOR,entry);}
 }
 return{schemaVersion:1,rootAttested:true,complete:true,invocationId,toolSha256,entries:[...entries.values()].sort((a,b)=>Number(a.__REALTIME_TIMESTAMP)-Number(b.__REALTIME_TIMESTAMP)),service:serviceObservation(run)};
}
export function transitionCasePath(requestId,stateRoot=HOST_PATHS.state){if(!uuid(requestId))throw new Error("TRANSITION_REQUEST_INVALID");return path.join(stateRoot,`legacy-transition-${requestId}`);}
export function assertNoIncompleteLegacyArchives(stateRoot=HOST_PATHS.state){
 for(const name of readdirSync(stateRoot).filter(name=>name.startsWith("legacy-transition-"))){
  if(!/^legacy-transition-[0-9a-f-]{36}$/.test(name))throw new Error("LEGACY_TRANSITION_FINALIZATION_REQUIRED");
  const directory=path.join(stateRoot,name),meta=lstatSync(directory);if(!meta.isDirectory()||meta.isSymbolicLink()||meta.uid!==process.getuid?.()||(meta.mode&0o077)!==0||realpathSync(directory)!==directory)throw new Error("LEGACY_TRANSITION_FINALIZATION_REQUIRED");
  const ledger=JSON.parse(trustedRead(`${directory}/ledger.json`,meta.uid));
  assertLegacyArchiveComplete(ledger,{requestId:name.slice(18),archivedRequest:trustedRead(`${directory}/request.archived.json`,meta.uid),originalRequest:trustedRead(`${directory}/original-request.json`,meta.uid),originalLatest:trustedRead(`${directory}/original-latest.json`,meta.uid),evidence:trustedRead(`${directory}/evidence.json`,meta.uid)});
 }
}
export function assertNoIncompleteSourceAdoptions(stateRoot=HOST_PATHS.state,{except=null}={}){for(const name of readdirSync(stateRoot).filter(name=>/^source-adoption-.*\.json$/.test(name)&&name!==except)){const value=JSON.parse(trustedRead(path.join(stateRoot,name),process.getuid()));if(value.schemaVersion!==1||value.stage!=="COMPLETE")throw new Error("SOURCE_ADOPTION_FINALIZATION_REQUIRED");}}
export function collectTransitionEvidence({requestId,invocationId,toolSha256,run=hostRead,uid=process.getuid?.()}){
 const caseRoot=transitionCasePath(requestId),state=HOST_PATHS.state;
 const read=file=>trustedRead(file,uid),json=file=>JSON.parse(read(file));
 const rawRequest=read(existsSync(`${state}/request.json`)?`${state}/request.json`:`${caseRoot}/request.archived.json`),rawLatest=read(`${state}/latest.json`),request=JSON.parse(rawRequest),latest=JSON.parse(rawLatest);
 if(request.requestId!==requestId||!uuid(latest.attempts?.at(-1)?.attemptId))throw new Error("TRANSITION_REQUEST_IDENTITY_INVALID");
 const bootstrap=json(`${state}/bootstrap-${requestId}-${latest.attempts.at(-1).attemptId}.json`),accepted=json(`${state}/last-success.json`);
 if(!/^[0-9a-f]{32}$/.test(invocationId??""))throw new Error("TRANSITION_INVOCATION_INVALID");
 const directory=lstatSync(TRANSITION_EVIDENCE_ROOT);if(!directory.isDirectory()||directory.isSymbolicLink()||directory.uid!==0||(directory.mode&0o022)!==0||realpathSync(TRANSITION_EVIDENCE_ROOT)!==TRANSITION_EVIDENCE_ROOT)throw new Error("TRANSITION_ROOT_ATTESTATION_DIRECTORY_INVALID");
 const journal=JSON.parse(trustedRead(`${TRANSITION_EVIDENCE_ROOT}/${invocationId}.json`,0));
 if(journal.invocationId!==invocationId||journal.schemaVersion!==1||journal.toolSha256!==toolSha256)throw new Error("TRANSITION_ROOT_ATTESTATION_INVALID");
 const git=args=>run("git",args,{cwd:HOST_PATHS.source});
 const show=(commit,file)=>{if(!/^[0-9a-f]{40}$/.test(commit??""))throw new Error("TRANSITION_SOURCE_INVALID");return git(["show",`${commit}:${file}`]);};
 const old=show(latest.bootstrapCommit,"scripts/deploy-production-bootstrap.mjs"),runner=show(latest.targetCommit,"scripts/deploy-production-runner.mjs"),entry=show(latest.targetCommit,"scripts/lib/controller-entry.mjs");
 const sourceProof={bootstrap:sha256(old),runner:sha256(runner),entry:sha256(entry),guardBeforeBusiness:runner.indexOf("await productionControllerEntry();")>0&&runner.indexOf("await productionControllerEntry();")<runner.indexOf("mkdirSync(")&&entry.indexOf("controllerEntryIdentity(request,environment),file=")>0};
 const inventory={inventoryComplete:true,journals:[],logs:[],admittedEntries:[],conflictingHistory:[]};
 for(const name of readdirSync(state).filter(value=>value.endsWith(".json"))){
  const value=json(`${state}/${name}`);if(value.requestId!==requestId)continue;
  if(value.deploymentId)inventory.journals.push(name);
  if(value.outcome==="ADMITTED")inventory.admittedEntries.push(name);
  if(value.controllerStarted&&name!=="latest.json"&&name!==`bootstrap-${requestId}-${latest.attempts.at(-1).attemptId}.json`)inventory.conflictingHistory.push(name);
 }
 // A runner creates an exclusive deployment log before its journal. Inventory all
 // logs created during/after this attempt, including empty files and unknown IDs.
 const since=Date.parse(latest.attempts.at(-1).startedAt);
 for(const name of readdirSync("/var/log/lumina-crm/deployments")){const file=`/var/log/lumina-crm/deployments/${name}`,meta=lstatSync(file);if(!meta.isFile()||meta.isSymbolicLink())throw new Error("TRANSITION_LOG_INVENTORY_INVALID");if(meta.birthtimeMs>=since||meta.mtimeMs>=since)inventory.logs.push(name);}
 const snapshot=collectHostSnapshot(),environment={PATH:"/usr/bin:/bin",DOCKER_HOST:`unix:///run/user/${uid}/docker.sock`,DOCKER_CONFIG:HOST_PATHS.dockerConfig,BUILDX_CONFIG:HOST_PATHS.buildxConfig};
 const runtime={isolated:snapshot.isolated,uid};
 if(snapshot.isolated)for(const name of ["web","worker"]){
  const ids=run("/usr/bin/docker",["ps","--all","--quiet","--no-trunc","--filter","label=com.docker.compose.project=lumina-crm","--filter",`label=com.docker.compose.service=${name}`],{env:environment}).trim().split(/\s+/);
  if(ids.length!==1||!/^[0-9a-f]{64}$/.test(ids[0]))throw new Error("TRANSITION_RUNTIME_IDENTITY_AMBIGUOUS");
  const values=JSON.parse(run("/usr/bin/docker",["container","inspect",ids[0]],{env:environment}));if(values.length!==1||values[0].Id!==ids[0])throw new Error("TRANSITION_RUNTIME_INSPECTION_INVALID");const value=values[0];
  runtime[name]={image:value.Config.Image,imageId:value.Image,state:value.State.Status,health:value.State.Health?.Status,project:value.Config.Labels?.["com.docker.compose.project"],revision:value.Config.Labels?.["org.opencontainers.image.revision"],createdAt:value.Created};
 }
 const service=serviceObservation(run),serviceActive=!["inactive","failed"].includes(service.activeState);
 return{request,latest,bootstrap,accepted,journal,sourceProof,state:inventory,runtime,service,serviceActive,rawRequest,rawLatest,toolSha256};
}
export function fileArchiveOperations(options){
 const stateRoot=options.stateRoot??HOST_PATHS.state,caseRoot=transitionCasePath(options.requestId,stateRoot),uid=options.uid??process.getuid(),requestPath=path.join(stateRoot,"request.json");
 const read=options.read??(file=>trustedRead(file,uid));
 const assertCase=options.verifyDirectory??(()=>{const meta=lstatSync(caseRoot);if(!meta.isDirectory()||meta.isSymbolicLink()||meta.uid!==uid||(meta.mode&0o077)!==0||realpathSync(caseRoot)!==caseRoot)throw new Error("TRANSITION_CASE_INVALID");});
 const once=(name,text)=>{const file=`${caseRoot}/${name}`;if(existsSync(file)){if(read(file)!==text)throw new Error("TRANSITION_ORIGINAL_CHANGED");}else durableText(file,text,{exclusive:true});};
 const verifyArchive=ledger=>{if(existsSync(requestPath)||sha256(read(`${caseRoot}/request.archived.json`))!==ledger.plan.requestSha256||sha256(read(`${caseRoot}/original-request.json`))!==ledger.plan.requestSha256||sha256(read(`${caseRoot}/original-latest.json`))!==ledger.plan.latestSha256||sha256(read(path.join(stateRoot,"latest.json")))!==ledger.plan.latestSha256)throw new Error("TRANSITION_ARCHIVE_NOT_VERIFIED");};
 return{exclusive:options.exclusive??(async operation=>{if(!hostLocksHeld([HOST_PATHS.admissionLock,HOST_PATHS.deployLock,HOST_PATHS.maintenanceLock]))throw new Error("TRANSITION_LOCK_REQUIRED");return operation();}),collect:options.collect??(()=>collectTransitionEvidence(options)),readLedger:()=>{if(!existsSync(caseRoot))return null;assertCase();return existsSync(`${caseRoot}/ledger.json`)?JSON.parse(read(`${caseRoot}/ledger.json`)):null;},persist:ledger=>{if(!existsSync(caseRoot))mkdirSync(caseRoot,{mode:0o700});assertCase();durableText(`${caseRoot}/ledger.json`,`${JSON.stringify(ledger)}\n`);},saveOriginals:evidence=>{once("original-request.json",evidence.rawRequest);once("original-latest.json",evidence.rawLatest);once("evidence.json",`${JSON.stringify(evidence)}\n`);},renameRequestOnce:evidence=>{if(existsSync(`${caseRoot}/request.archived.json`)){if(existsSync(requestPath))throw new Error("TRANSITION_ARCHIVE_COLLISION");return;}if(read(requestPath)!==evidence.rawRequest)throw new Error("TRANSITION_REQUEST_CHANGED");renameSync(requestPath,`${caseRoot}/request.archived.json`);if(process.platform!=="win32")for(const directory of [caseRoot,stateRoot]){const fd=openSync(directory,"r");try{fsyncSync(fd);}finally{closeSync(fd);}}},verifyArchive};
}
export function transitionToolHash(sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..")){
 const files=["scripts/deploy-legacy-transition.mjs","scripts/lib/legacy-transition-host.mjs","scripts/lib/legacy-transition-archive.mjs","deploy/libexec/host-compatibility-catalog.json","scripts/lib/host-preflight.mjs","scripts/lib/host-capabilities.mjs","scripts/lib/host-trust.mjs","scripts/lib/docker-build-proxy.mjs","scripts/lib/deployment-runtime.mjs","deploy/libexec/lumina-host-contract.mjs","deploy/libexec/lumina-host-upgrade.mjs","deploy/libexec/host-runtime-contract.json"];
 return sha256(JSON.stringify(Object.fromEntries(files.map(file=>[file,sha256(readFileSync(path.join(sourceRoot,file)))]))));
}
export function describeTransitionFailure(error){return{error:error.message,missing:error.assessment?.missing??[],failed:error.assessment?.failed??[],remediation:"Preserve all evidence. Obtain an independent operator audit if invocation logs, immutable source proof or accepted runtime observations cannot prove absence of business effects."};}
export {assessLegacyTransition,HOST_COMPATIBILITY};
