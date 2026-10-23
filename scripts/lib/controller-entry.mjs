import {readFileSync,writeFileSync,openSync,closeSync,fsyncSync} from "node:fs";
import {spawnSync} from "node:child_process";
import path from "node:path";
import {HOST_PATHS,sha256} from "../../deploy/libexec/lumina-host-contract.mjs";
import {assertDeploymentRuntime} from "./deployment-runtime.mjs";
import {assertHostPreflight} from "./host-preflight.mjs";
import {hostLocksHeld} from "../../deploy/libexec/lumina-host-upgrade.mjs";
const uuid=value=>/^[0-9a-f-]{36}$/i.test(value??"");
export function controllerEntryIdentity(request,environment=process.env){
 const attemptId=environment.LUMINA_BOOTSTRAP_ATTEMPT_ID,nonce=environment.LUMINA_HOST_HANDOFF_NONCE,targetCommit=environment.LUMINA_TARGET_SOURCE_COMMIT;
 if(!uuid(request?.requestId)||!uuid(request.launchId)||!uuid(attemptId)||!uuid(nonce)||!/^[0-9a-f]{40}$/.test(targetCommit??""))throw new Error("CONTROLLER_ENTRY_IDENTITY_INVALID");
 return{requestId:request.requestId,launchId:request.launchId,mode:request.mode,attemptId,nonce,targetCommit};
}
export function controllerEntryPath(identity,stateRoot=HOST_PATHS.state){return path.join(stateRoot,`entry-${identity.requestId}-${identity.launchId}-${identity.nonce}.json`);}
export function validateEarlyRejection(receipt,identity){
 if(receipt?.schemaVersion!==1||receipt.outcome!=="REJECTED"||receipt.businessEffects!=="NOT_STARTED"||!["HOST_PREFLIGHT_FAILED","NODE_RUNTIME_INCOMPATIBLE"].includes(receipt.code)||Object.entries(identity).some(([key,value])=>receipt[key]!==value))throw new Error("EARLY_REJECTION_UNVERIFIED");
 return receipt;
}
export async function runControllerEntry({request,environment=process.env,stateRoot=HOST_PATHS.state,nodeVersion=process.version,preflight=()=>assertHostPreflight({executionLockHeld:true}),validateSource=()=>{
 const result=spawnSync("git",["rev-parse","HEAD"],{cwd:HOST_PATHS.source,encoding:"utf8",timeout:3000});if(result.status!==0||result.stdout.trim()!==environment.LUMINA_TARGET_SOURCE_COMMIT)throw new Error("CONTROLLER_ENTRY_SOURCE_CHANGED");
 const status=spawnSync("git",["status","--porcelain"],{cwd:HOST_PATHS.source,encoding:"utf8",timeout:3000});if(status.status!==0||status.stdout.trim())throw new Error("CONTROLLER_ENTRY_SOURCE_CHANGED");
},write=(file,value)=>{const fd=openSync(file,"wx",0o600);try{writeFileSync(fd,`${JSON.stringify(value)}\n`);fsyncSync(fd);}finally{closeSync(fd);}if(process.platform!=="win32"){const directory=openSync(path.dirname(file),"r");try{fsyncSync(directory);}finally{closeSync(directory);}}}}){
 const identity=controllerEntryIdentity(request,environment),file=controllerEntryPath(identity,stateRoot);
 await validateSource();
 try{assertDeploymentRuntime(nodeVersion);await preflight();}
 catch(error){if(!["HOST_PREFLIGHT_FAILED","NODE_RUNTIME_INCOMPATIBLE"].includes(error.code))throw error;const receipt={schemaVersion:1,...identity,outcome:"REJECTED",businessEffects:"NOT_STARTED",code:error.code,nodeVersion,controllerPid:process.pid,nodeExecutable:process.execPath,at:new Date().toISOString()};await write(file,receipt);throw Object.assign(new Error(error.code),{code:error.code,entryReceiptSha256:sha256(JSON.stringify(receipt))});}
 const receipt={schemaVersion:1,...identity,outcome:"ADMITTED",businessEffects:"MAY_START",nodeVersion,controllerPid:process.pid,nodeExecutable:process.execPath,at:new Date().toISOString()};await write(file,receipt);return receipt;
}
export async function productionControllerEntry(environment=process.env){
 if(!hostLocksHeld([HOST_PATHS.deployLock]))throw new Error("CONTROLLER_ENTRY_LOCK_REQUIRED");
 const request=JSON.parse(readFileSync(`${HOST_PATHS.state}/request.json`,"utf8"));return runControllerEntry({request,environment});
}
