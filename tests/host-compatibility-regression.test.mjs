import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,lstatSync,rmSync,existsSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {HOST_CONTRACT,HOST_COMPATIBILITY,componentDiagnostic} from "../deploy/libexec/lumina-host-contract.mjs";
import {validateBuildxInspectContract} from "../scripts/lib/docker-build-proxy.mjs";
import {validateBuilderInspect} from "../deploy/libexec/lumina-crm-storage-maintenance.mjs";
import {probeHostCapabilities,REQUIRED_DOCKER_CAPABILITIES} from "../scripts/lib/host-capabilities.mjs";
import {validateLegacyHandoff} from "../scripts/lib/legacy-handoff.mjs";
import {controllerEntryIdentity,runControllerEntry,validateEarlyRejection} from "../scripts/lib/controller-entry.mjs";
import {localHostTarget,evaluateHostSnapshot} from "../scripts/lib/host-preflight.mjs";
import {assessLegacyTransition,legacyTransitionPlan,archiveLegacyTransition,assertLegacyArchiveComplete} from "../scripts/lib/legacy-transition-archive.mjs";
import {captureTransitionJournal,fileArchiveOperations,transitionCasePath} from "../scripts/lib/legacy-transition-host.mjs";
import {sourceAdoptionPlan} from "../scripts/deploy-legacy-transition.mjs";

const repository=fileURLToPath(new URL("..",import.meta.url));
const legacy="796cc43e63784eb8891ca6420572cd563cb2ac80",failure="c164ff1524192b7d699dae1962c02bf72566407b",target="b".repeat(40),uid=1001,invocation="f".repeat(32);
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`,clone=value=>JSON.parse(JSON.stringify(value));
const model={services:{web:{user:"10001:10001",init:true,read_only:true,cap_drop:["ALL"],security_opt:["no-new-privileges:true"],pids_limit:256,mem_limit:536870912,cpus:1,tmpfs:["/tmp:rw,noexec,nosuid,nodev"],ports:[{host_ip:"127.0.0.1"}]}},networks:{backend:{internal:true}}};
function capabilityRun(command,args,env,input){assert.equal(command,"/usr/bin/docker");assert.ok(args.includes("--help")||args.includes("config"));if(args.includes("--help"))return{status:0,stdout:REQUIRED_DOCKER_CAPABILITIES.find(p=>JSON.stringify(p.args)===JSON.stringify(args)).flags.join(" ")};assert.ok(input.includes("example.invalid/fictional-crm"));return{status:0,stdout:JSON.stringify(model)};}
function snapshot(image="moby/buildkit:v0.33.1"){
 const endpoint="unix:///run/user/1001/docker.sock",fingerprint="f".repeat(64);
 return{versions:{node:"24.22.1",npm:"12.2.1",docker:"29.1.3",compose:"2.40.3+ds1-0ubuntu1",buildx:"0.30.1-0ubuntu1"},systemdNode:"24.22.1",sameNode:true,identity:true,isolated:true,dockerServiceReady:true,builder:{endpoint,fingerprint,proxy:"",image,marker:{owner:"kewtgh/crm",builder:"lumina-crm-buildkit",driver:"docker-container",builderNetworkMode:"host",configSha256:fingerprint,dockerProxyEnabled:false,dockerProxySha256:null},inspect:`Name: lumina-crm-buildkit\nDriver: docker-container\nEndpoint: ${endpoint}\nDriver Options: network="host" image="${image}"\n`},builderDaemon:{image,network:"host"},maintenanceTrust:{protocol:0,trust:"LEGACY_SUPPORTED",builderImages:["moby/buildkit:v0.33.1","moby/buildkit:v0.34.1"],capabilities:["trusted-code"]},capabilities:probeHostCapabilities(capabilityRun,{}),unitsReady:true,admissionLockReady:true,deployLockFree:true,maintenanceLockFree:true,operationPending:false,diskReady:true,disk:[]};
}
test("Ubuntu packaged baseline is supported with capability evidence despite newer recommendations",()=>{
 const report=evaluateHostSnapshot(snapshot(),localHostTarget());assert.equal(report.ready,true,JSON.stringify(report));
 for(const component of ["docker","compose","buildx"])assert.equal(report.diagnostics.find(row=>row.component===component).status,"SUPPORTED");
 assert.equal(report.diagnostics.find(row=>row.component==="maintenance.bundle").status,"LEGACY_SUPPORTED");
 const incompatible=snapshot();incompatible.maintenanceTrust.builderImages=["moby/buildkit:v0.34.1"];assert.equal(evaluateHostSnapshot(incompatible,localHostTarget()).diagnostics.find(row=>row.component==="maintenance.bundle").blocking,true);
 for(const [component,values] of Object.entries({docker:["29.1.2","29.2.0","30.0.0","29.1.3-rc1"],compose:["2.40.2","3.0.0","2.40.3+ds1-0ubuntu1~beta"],buildx:["0.30.0","0.31.0","0.30.1-rc.1"]}))for(const version of values)assert.equal(componentDiagnostic(component,version,HOST_CONTRACT.components[component]).blocking,true,version);
});
test("missing capabilities and uninspected components block with accurate dependency status",()=>{
 const missing=probeHostCapabilities((command,args,env,input)=>{const result=capabilityRun(command,args,env,input);return{...result,stdout:result.stdout.replace("--provenance","")};},{});assert.equal(missing.ready,false);
 assert.equal(evaluateHostSnapshot({...snapshot(),capabilities:missing},localHostTarget()).ready,false);
 const unsafe=clone(model);unsafe.services.web.read_only=false;assert.equal(probeHostCapabilities((cmd,args,env,input)=>args.includes("--help")?capabilityRun(cmd,args,env,input):{status:0,stdout:JSON.stringify(unsafe)},{}).ready,false);
 const report=evaluateHostSnapshot({...snapshot(),isolated:false,versions:{node:"24.22.1",npm:"12.2.1"}},localHostTarget());for(const name of ["docker","compose","buildx","docker.capabilities","buildkit"])assert.equal(report.diagnostics.find(row=>row.component===name).status,"DEPENDENCY_BLOCKED");
 assert.equal(componentDiagnostic("compose",null,HOST_CONTRACT.components.compose).status,"NOT_CHECKED");
});
test("audited builder images preserve network, proxy, operation and owner checks",()=>{
 for(const image of ["moby/buildkit:v0.33.1","moby/buildkit:v0.34.1"]){const inspect=snapshot(image).builder.inspect;assert.ok(validateBuildxInspectContract(inspect,{builderName:"lumina-crm-buildkit",dockerProxy:""}));assert.ok(validateBuilderInspect(inspect,""));for(const text of [inspect.replace('network="host"','network="bridge"'),inspect.replace(image,"moby/buildkit:v0.35.0"),inspect.replace('network="host"','network="host" env.HTTP_PROXY="http://proxy.example.test:8080"')]){assert.throws(()=>validateBuildxInspectContract(text,{builderName:"lumina-crm-buildkit",dockerProxy:""}));assert.throws(()=>validateBuilderInspect(text,""));}}
 const value=snapshot();value.builder.marker.owner="fictional/other";assert.equal(evaluateHostSnapshot(value,localHostTarget()).ready,false);
});
function handoff(){
 const request={requestId:id(1),launchId:id(2),mode:"deploy",sourceRoot:"/opt/lumina-crm/source"};
 const latest={...request,result:"BOOTSTRAP_RUNNING",stage:"target-controller-start",controllerStarted:true,deploymentId:null,applicationResult:"NOT_STARTED",migrationState:"NOT_STARTED",migrationMayHaveChanged:false,webSwitch:"NOT_STARTED",workerSwitch:"NOT_STARTED",applicationAccepted:false,finalizationComplete:false,requestArchived:false,bootstrapCommit:legacy,targetCommit:target,attempts:[{attemptId:id(3),controllerStarted:true,startedAt:"2026-10-24T00:00:00.000Z"}]};
 return{request,latest,bootstrap:clone(latest),launch:{bootstrapSource:legacy,expectedTarget:target,bootstrapPid:200},parent:{pid:200,ppid:100,uid,exe:"/usr/bin/node",argv:["/usr/bin/node",path.join("/opt/lumina-crm/source","scripts/deploy-production-bootstrap.mjs")],start:20,cgroup:"/system.slice/lumina-crm-deploy.service"},child:{pid:201,ppid:200,uid,exe:"/usr/bin/node",start:30,cgroup:"/system.slice/lumina-crm-deploy.service"},service:{mainPid:100,mainStart:10,user:"lumina-crm",activeState:"active",invocationId:invocation,controlGroup:"/system.slice/lumina-crm-deploy.service"},source:{head:target,clean:true,branch:"main",origin:"https://github.com/kewtgh/crm.git"},sourceHashes:{bootstrap:HOST_COMPATIBILITY.revisions[legacy].files["scripts/deploy-production-bootstrap.mjs"]},transition:{previousHead:legacy,fastForward:true,at:1000,parentStartedAt:0,childStartedAt:2000},stateMetadataVerified:true,unitVerified:true,lockHeld:true,uid,sourceRoot:request.sourceRoot,invocationId:invocation};
}
test("legacy handoff rejects forged source, PID, lock, unit, persisted intent and protocol downgrade",async()=>{
 assert.equal(validateLegacyHandoff(handoff()).handoffProtocol,0);
 for(const mutate of [v=>v.launch.bootstrapSource=failure,v=>v.parent.pid++,v=>v.child.ppid++,v=>v.lockHeld=false,v=>v.transition.previousHead=failure,v=>v.transition.parentStartedAt=10000,v=>v.unitVerified=false,v=>v.service.invocationId="0".repeat(32),v=>v.request.handoffProtocol=2,v=>v.request.handoffProtocol=1,v=>v.request.handoffProtocol=999,v=>v.latest.webSwitch="STARTED",v=>v.sourceHashes.bootstrap="0".repeat(64),v=>v.source.clean=false]){const value=handoff();mutate(value);assert.throws(()=>validateLegacyHandoff(value),/LEGACY_HANDOFF_REJECTED/);}
 const context=handoff();await assert.rejects(runControllerEntry({request:context.request,legacyContext:context,environment:{LUMINA_HOST_HANDOFF_PROTOCOL:"2",LUMINA_TARGET_SOURCE_COMMIT:target},write:()=>assert.fail("no receipt"),validateSource:()=>{}}),/IDENTITY_INVALID/);
 assert.throws(()=>controllerEntryIdentity(context.request,{LUMINA_TARGET_SOURCE_COMMIT:target}),/IDENTITY_INVALID/);assert.throws(()=>validateEarlyRejection({handoffProtocol:0},{}),/UNVERIFIED/);
});
function transition(){
 const context=handoff(),latest={...context.latest,targetCommit:failure,result:"BOOTSTRAP_FAILED",stage:"target-controller-exit",error:"TARGET_CONTROLLER_EXIT_FAILED",recoverySafe:false,earlyRejection:null};
 const accepted={requestId:id(9),commit:legacy,version:"3.40.0",currentImage:`lumina-crm:${legacy}`,acceptedAt:"2026-10-23T00:00:00Z"};
 let cursor=0;const log=MESSAGE=>({MESSAGE,__CURSOR:`fictional-${cursor++}`,__REALTIME_TIMESTAMP:"1792800000100000",_UID:String(uid),_SYSTEMD_INVOCATION_ID:invocation,_SYSTEMD_UNIT:"lumina-crm-deploy.service"});
 const entries=[`BOOTSTRAP_SOURCE_COMMIT=${legacy}`,`TARGET_SOURCE_COMMIT=${failure}`,"HOST_NODE_VERSION=v24.22.1","COMPATIBILITY_RESULT=COMPATIBLE","TARGET_APPLICATION_VERSION=3.40.0","TARGET_CONTROLLER_PID=201","Error: CONTROLLER_ENTRY_IDENTITY_INVALID","    at controllerEntryIdentity (file:///opt/lumina-crm/source/scripts/lib/controller-entry.mjs:12:1)","    at productionControllerEntry (file:///opt/lumina-crm/source/scripts/lib/controller-entry.mjs:33:1)"].map(log);
 entries.push({...log("Main process exited"),_UID:"0",_PID:"1",UNIT:"lumina-crm-deploy.service",INVOCATION_ID:invocation,EXIT_CODE:"exited",EXIT_STATUS:"1"});
 const runtime={isolated:true,uid};for(const name of ["web","worker"])runtime[name]={image:accepted.currentImage,imageId:`sha256:${"a".repeat(64)}`,state:"running",health:"healthy",project:"lumina-crm",revision:legacy,createdAt:"2026-10-23T00:00:00Z"};
 return{request:context.request,latest,bootstrap:clone(latest),accepted,journal:{rootAttested:true,complete:true,invocationId:invocation,entries},sourceProof:{bootstrap:context.sourceHashes.bootstrap,runner:HOST_COMPATIBILITY.revisions[failure].files["scripts/deploy-production-runner.mjs"],entry:HOST_COMPATIBILITY.revisions[failure].files["scripts/lib/controller-entry.mjs"],guardBeforeBusiness:true},runtime,state:{inventoryComplete:true,journals:[],logs:[],admittedEntries:[],conflictingHistory:[]},serviceActive:false,service:{result:"exit-code",execMainStatus:"1",invocationId:invocation},rawRequest:JSON.stringify(context.request),rawLatest:JSON.stringify(latest),toolSha256:"c".repeat(64)};
}
test("legacy transition requires multiple independent proofs and rejects all business/finalization ambiguity",()=>{
 assert.equal(assessLegacyTransition(transition()).eligible,true,JSON.stringify(assessLegacyTransition(transition())));
 for(const mutate of [v=>v.journal=null,v=>v.journal.entries=[],v=>v.journal.entries[6].MESSAGE="unrelated failure",v=>v.journal.entries.at(-1)._UID="1001",v=>v.sourceProof.guardBeforeBusiness=false,v=>v.latest.migrationMayHaveChanged=true,v=>v.latest.webSwitch="STARTED",v=>v.latest.applicationAccepted=true,v=>v.latest.result="CONTROL_PLANE_FINALIZATION_FAILED",v=>v.state.journals.push("fictional.json"),v=>v.state.logs.push("empty.log"),v=>v.state.admittedEntries.push("entry.json"),v=>v.runtime.web.createdAt="2026-10-24T00:00:01Z",v=>v.runtime.worker.image="other:image",v=>v.accepted.commit=target,v=>v.serviceActive=true,v=>v.journal.entries[0]._LINE_BREAK="line-max"]){const value=transition();mutate(value);assert.equal(assessLegacyTransition(value).eligible,false);assert.throws(()=>legacyTransitionPlan(value),/EVIDENCE_INCOMPLETE/);}
});
test("legacy archival approval preserves originals/latest and resumes after rename without repeating it",async()=>{
 const evidence=transition(),plan=legacyTransitionPlan(evidence);let ledger=null,renames=0,failed=false,busy=false;const files=new Map();
 const operations={exclusive:async fn=>{if(busy)throw Error("BUSY");busy=true;try{return await fn();}finally{busy=false;}},collect:async()=>clone(evidence),readLedger:async()=>clone(ledger),persist:async value=>{if(value.stage==="ARCHIVED"&&!failed){failed=true;throw Error("DISK_FAILURE");}ledger=clone(value);},saveOriginals:async value=>{files.set("request",value.rawRequest);files.set("latest",value.rawLatest);},renameRequestOnce:async()=>{if(!renames)renames++;},verifyArchive:async()=>{assert.equal(files.get("request"),evidence.rawRequest);assert.equal(files.get("latest"),evidence.rawLatest);}};
 await assert.rejects(archiveLegacyTransition({plan,approval:null,operations}),/APPROVAL_REQUIRED/);assert.equal(ledger,null);
 await assert.rejects(archiveLegacyTransition({plan,approval:plan.approvalSha256,operations}),/DISK_FAILURE/);assert.equal(ledger.stage,"ARCHIVE_INTENT");
 assert.equal((await archiveLegacyTransition({plan,approval:plan.approvalSha256,operations})).stage,"ARCHIVED");assert.equal(renames,1);assert.equal(evidence.latest.result,"BOOTSTRAP_FAILED");assert.equal(evidence.latest.controllerStarted,true);
 const changed=clone(evidence);changed.accepted.acceptedAt="2026-10-22T00:00:00Z";await assert.rejects(archiveLegacyTransition({plan,approval:plan.approvalSha256,operations:{...operations,collect:async()=>changed}}),/EVIDENCE_CHANGED/);
 busy=true;await assert.rejects(archiveLegacyTransition({plan,approval:plan.approvalSha256,operations}),/BUSY/);
});
test("journal collection queries complete service and trusted manager invocation streams without truncation",()=>{
 const calls=[];const result=captureTransitionJournal(invocation,"a".repeat(64),{run:(cmd,args)=>{calls.push({cmd,args});if(cmd.endsWith("systemctl"))return`ActiveState=failed\nResult=exit-code\nExecMainStatus=1\nInvocationID=${invocation}`;return JSON.stringify({__CURSOR:args.at(-1),__REALTIME_TIMESTAMP:"1000",MESSAGE:"fictional"});}});assert.equal(result.entries.length,2);assert.ok(calls.some(call=>call.args.includes(`INVOCATION_ID=${invocation}`)));assert.ok(calls.every(call=>!call.args.includes("-n")));
});
test("file-backed legacy archive retains byte-exact evidence across a completion-write failure",async t=>{
 const stateRoot=mkdtempSync(path.join(os.tmpdir(),"crm-transition-files-"));t.after(()=>rmSync(stateRoot,{recursive:true,force:true,maxRetries:3,retryDelay:50}));
 const evidence=transition(),plan=legacyTransitionPlan(evidence),caseRoot=transitionCasePath(evidence.request.requestId,stateRoot);
 writeFileSync(path.join(stateRoot,"request.json"),evidence.rawRequest);writeFileSync(path.join(stateRoot,"latest.json"),evidence.rawLatest);
 const operations=fileArchiveOperations({requestId:evidence.request.requestId,stateRoot,uid:1001,exclusive:async fn=>fn(),read:file=>readFileSync(file,"utf8"),verifyDirectory:()=>{const meta=lstatSync(caseRoot);assert.ok(meta.isDirectory()&&!meta.isSymbolicLink());},collect:()=>clone(evidence)}),persist=operations.persist;let fail=true;
 operations.persist=ledger=>{if(ledger.stage==="ARCHIVED"&&fail){fail=false;throw Error("COMPLETION_WRITE_FAILED");}return persist(ledger);};
 await assert.rejects(archiveLegacyTransition({plan,approval:plan.approvalSha256,operations}),/COMPLETION_WRITE_FAILED/);
 assert.equal(existsSync(path.join(stateRoot,"request.json")),false);assert.equal(JSON.parse(readFileSync(path.join(caseRoot,"ledger.json"))).stage,"ARCHIVE_INTENT");
 const originals={requestId:evidence.request.requestId,archivedRequest:evidence.rawRequest,originalRequest:evidence.rawRequest,originalLatest:evidence.rawLatest,evidence:JSON.stringify(evidence)};
 assert.throws(()=>assertLegacyArchiveComplete(JSON.parse(readFileSync(path.join(caseRoot,"ledger.json"))),originals),/FINALIZATION_REQUIRED/);
 await archiveLegacyTransition({plan,approval:plan.approvalSha256,operations});
 for(const name of ["original-request.json","request.archived.json"])assert.equal(readFileSync(path.join(caseRoot,name),"utf8"),evidence.rawRequest);
 assert.equal(readFileSync(path.join(caseRoot,"original-latest.json"),"utf8"),evidence.rawLatest);assert.equal(readFileSync(path.join(stateRoot,"latest.json"),"utf8"),evidence.rawLatest);
 const ledger=JSON.parse(readFileSync(path.join(caseRoot,"ledger.json")));assert.equal(ledger.stage,"ARCHIVED");assertLegacyArchiveComplete(ledger,originals);
 assert.throws(()=>assertLegacyArchiveComplete(ledger,{...originals,archivedRequest:"changed"}),/FINALIZATION_REQUIRED/);
});
test("source-only adoption reads static target data before any merge and rejects unknown source",async()=>{
 const calls=[],run=(cmd,args)=>{calls.push(args);if(args[0]==="show")return readFileSync(path.join(repository,args[1].slice(41)),"utf8");if(args[0]==="rev-parse")return legacy;if(args[0]==="branch")return"main";if(args[0]==="remote")return"https://github.com/kewtgh/crm.git";return"";};
 let checked=false;const plan=await sourceAdoptionPlan({target,toolSha256:"a".repeat(64),run,preflight:options=>{checked=true;assert.equal(options.target.commit,target);assert.equal(evaluateHostSnapshot(snapshot(),options.target).ready,true);}});assert.equal(plan.before,legacy);assert.equal(checked,true);assert.equal(calls.some(args=>args[0]==="merge"),false);
 await assert.rejects(sourceAdoptionPlan({target,run:(cmd,args)=>args[0]==="rev-parse"?"e".repeat(40):run(cmd,args),preflight:()=>assert.fail("unknown source")}),/SOURCE_NOT_AUDITED/);
});
