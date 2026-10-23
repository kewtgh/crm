import {readFileSync,realpathSync,lstatSync} from "node:fs";
import {spawnSync} from "node:child_process";
import path from "node:path";
import {HOST_PATHS,HOST_COMPATIBILITY,sha256} from "../../deploy/libexec/lumina-host-contract.mjs";
import {hostLocksHeld} from "../../deploy/libexec/lumina-host-upgrade.mjs";
import {parseTargetControllerArguments} from "./target-controller-source.mjs";

const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function validateLegacyHandoff(context){
 const {request,latest,bootstrap,parent,child,service,source,sourceHashes,launch}=context;
 const reject=code=>{throw new Error(`LEGACY_HANDOFF_REJECTED:${code}`);};
 if(!launch||!HOST_COMPATIBILITY.legacyBootstrapSources.includes(launch.bootstrapSource))reject("SOURCE_NOT_APPROVED");
 if(!context.stateMetadataVerified||!context.unitVerified||request?.handoffProtocol!==undefined)reject("TRUST_METADATA");
 const profile=HOST_COMPATIBILITY.revisions[launch.bootstrapSource];
 if(sourceHashes?.bootstrap!==profile.files["scripts/deploy-production-bootstrap.mjs"])reject("SOURCE_CODE_CHANGED");
 if(!context.lockHeld||!parent||!child||parent.pid!==launch.bootstrapPid||child.ppid!==parent.pid||parent.pid===child.pid||parent.uid!==context.uid||child.uid!==context.uid||parent.exe!==child.exe||!equal(parent.argv,[parent.exe,path.join(context.sourceRoot,"scripts/deploy-production-bootstrap.mjs")]))reject("PROCESS_IDENTITY");
 if(!service||!['active','activating'].includes(service.activeState)||service.user!=="lumina-crm"||!/^[0-9a-f]{32}$/.test(service.invocationId??"")||service.invocationId!==context.invocationId||service.mainPid!==parent.ppid||service.controlGroup!==parent.cgroup||service.controlGroup!==child.cgroup||!(service.mainStart<=parent.start&&parent.start<=child.start))reject("SYSTEMD_IDENTITY");
 if(source?.head!==launch.expectedTarget||source.clean!==true||source.branch!=="main"||!["git@github.com:kewtgh/crm.git","https://github.com/kewtgh/crm.git"].includes(source.origin))reject("TARGET_SOURCE");
 const transition=context.transition;
 if(transition?.previousHead!==launch.bootstrapSource||transition?.fastForward!==true||!Number.isFinite(transition?.at)||!Number.isFinite(transition?.parentStartedAt)||!Number.isFinite(transition?.childStartedAt)||transition.parentStartedAt>transition.at+1000||transition.childStartedAt<transition.at-1000)reject("SOURCE_TRANSITION");
 if(request?.sourceRoot!==context.sourceRoot||!["deploy","initialize","rollback","recover"].includes(request.mode)||!/^[-0-9a-f]{36}$/i.test(request.requestId??"")||!/^[-0-9a-f]{36}$/i.test(request.launchId??"")||!equal(latest,bootstrap)||latest.requestId!==request.requestId||latest.launchId!==request.launchId||latest.mode!==request.mode||latest.bootstrapCommit!==launch.bootstrapSource||latest.targetCommit!==launch.expectedTarget)reject("REQUEST_BINDING");
 const attempt=latest.attempts?.at(-1);
 if(latest.result!=="BOOTSTRAP_RUNNING"||latest.stage!=="target-controller-start"||latest.controllerStarted!==true||latest.deploymentId!==null||latest.applicationResult!=="NOT_STARTED"||latest.migrationState!=="NOT_STARTED"||latest.migrationMayHaveChanged!==false||latest.webSwitch!=="NOT_STARTED"||latest.workerSwitch!=="NOT_STARTED"||latest.applicationAccepted!==false||latest.finalizationComplete!==false||latest.requestArchived!==false||attempt?.controllerStarted!==true||!/^[-0-9a-f]{36}$/i.test(attempt.attemptId??""))reject("PERSISTED_INTENT");
 return{requestId:request.requestId,launchId:request.launchId,mode:request.mode,attemptId:attempt.attemptId,targetCommit:launch.expectedTarget,handoffProtocol:0,bootstrapSource:launch.bootstrapSource,bootstrapPid:parent.pid,legacyProofSha256:sha256(JSON.stringify(context))};
}
export function readLinuxProcess(pid,{read=readFileSync,realpath=realpathSync}={}){
 if(!Number.isSafeInteger(pid)||pid<1)throw new Error("PROCESS_IDENTITY_INVALID");
 const stat=read(`/proc/${pid}/stat`,"utf8"),fields=stat.slice(stat.lastIndexOf(")")+2).split(/\s+/),status=read(`/proc/${pid}/status`,"utf8"),uid=Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]),groups=read(`/proc/${pid}/cgroup`,"utf8");
 return{pid,ppid:Number(fields[1]),start:Number(fields[19]),uid,exe:realpath(`/proc/${pid}/exe`),argv:read(`/proc/${pid}/cmdline`,"utf8").split("\0").filter(Boolean).map((value,index)=>index===0?realpath(`/proc/${pid}/exe`):value),cgroup:/^0::(.+)$/m.exec(groups)?.[1]};
}
export function collectLegacyHandoff(request,environment=process.env){
 const launch=parseTargetControllerArguments(process.argv.slice(2));
 if(process.argv.slice(2).length!==4||environment.LUMINA_BOOTSTRAP_SOURCE_COMMIT!==launch.bootstrapSource||environment.LUMINA_TARGET_SOURCE_COMMIT!==launch.expectedTarget||environment.LUMINA_HOST_HANDOFF_PROTOCOL||environment.LUMINA_BOOTSTRAP_ATTEMPT_ID||environment.LUMINA_HOST_HANDOFF_NONCE)throw new Error("LEGACY_HANDOFF_ARGUMENT_INVALID");
 const run=(command,args)=>{const result=spawnSync(command,args,{encoding:"utf8",timeout:5000,maxBuffer:2_000_000,cwd:HOST_PATHS.source});if(result.status!==0||result.error)throw new Error("LEGACY_HANDOFF_OBSERVATION_FAILED");return result.stdout;};
 const latest=JSON.parse(readFileSync(`${HOST_PATHS.state}/latest.json`,"utf8")),attempt=latest.attempts?.at(-1)?.attemptId;if(!/^[0-9a-f-]{36}$/.test(attempt??""))throw new Error("LEGACY_HANDOFF_ATTEMPT_MISSING");
 const parent=readLinuxProcess(process.ppid),child=readLinuxProcess(process.pid),fields=Object.fromEntries(run("/usr/bin/systemctl",["show","lumina-crm-deploy.service","--property=MainPID,InvocationID,ControlGroup,ActiveState,User,FragmentPath,DropInPaths,NeedDaemonReload","--no-pager"]).trim().split(/\r?\n/).map(line=>{const n=line.indexOf("=");return[line.slice(0,n),line.slice(n+1)];}));
 const main=readLinuxProcess(Number(fields.MainPID));
 const reflog=run("git",["reflog","-1","--date=unix","--format=%gD%n%gs"]).trim().split(/\r?\n/),at=Number(/^HEAD@\{(\d+)\}$/.exec(reflog[0])?.[1])*1000;
 const boot=Number(/^btime (\d+)$/m.exec(readFileSync("/proc/stat","utf8"))?.[1]),hz=Number(run("/usr/bin/getconf",["CLK_TCK"]).trim());
 if(!Number.isSafeInteger(hz)||hz<=0||!Number.isSafeInteger(boot))throw new Error("LEGACY_HANDOFF_PROCESS_CLOCK_INVALID");
 const transition={previousHead:run("git",["rev-parse","HEAD@{1}"]).trim(),fastForward:/^merge .+: Fast-forward$/.test(reflog[1]??""),at,parentStartedAt:(boot+parent.start/hz)*1000,childStartedAt:(boot+child.start/hz)*1000};
 const stateFiles=[`${HOST_PATHS.state}/request.json`,`${HOST_PATHS.state}/latest.json`,`${HOST_PATHS.state}/bootstrap-${request.requestId}-${attempt}.json`],stateMetadataVerified=stateFiles.every(file=>{const meta=lstatSync(file);return meta.isFile()&&!meta.isSymbolicLink()&&meta.uid===process.getuid()&&(meta.mode&0o022)===0&&realpathSync(file)===file;});
 const unit="/etc/systemd/system/lumina-crm-deploy.service",unitMeta=lstatSync(unit),unitHash=sha256(readFileSync(unit)),unitVerified=fields.FragmentPath===unit&&fields.DropInPaths===""&&fields.NeedDaemonReload==="no"&&unitMeta.uid===0&&unitMeta.isFile()&&!unitMeta.isSymbolicLink()&&(unitMeta.mode&0o022)===0&&realpathSync(unit)===unit&&Object.values(HOST_COMPATIBILITY.revisions).some(value=>value.unitHashes['lumina-crm-deploy.service']===unitHash);
 return{request,latest,bootstrap:JSON.parse(readFileSync(stateFiles[2],"utf8")),launch,parent,child,transition,stateMetadataVerified,unitVerified,uid:process.getuid(),sourceRoot:HOST_PATHS.source,invocationId:environment.INVOCATION_ID,lockHeld:hostLocksHeld([HOST_PATHS.deployLock]),service:{mainPid:main.pid,mainStart:main.start,user:fields.User,activeState:fields.ActiveState,invocationId:fields.InvocationID,controlGroup:fields.ControlGroup},source:{head:run("git",["rev-parse","HEAD"]).trim(),branch:run("git",["branch","--show-current"]).trim(),origin:run("git",["remote","get-url","origin"]).trim(),clean:!run("git",["status","--porcelain"]).trim()},sourceHashes:{bootstrap:sha256(run("git",["show",`${launch.bootstrapSource}:scripts/deploy-production-bootstrap.mjs`]))}};
}
