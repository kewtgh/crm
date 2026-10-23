import {randomUUID} from "node:crypto";
import {readFileSync,lstatSync,realpathSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {HOST_CONTRACT,HOST_PATHS,sha256,parseBuilderOptions,validateOwnedBuilder} from "./lumina-host-contract.mjs";

export function hostLocksHeld(files,{read=readFileSync,stat=lstatSync,realpath=realpathSync,pid=process.pid,platform=process.platform}={}){
 if(platform!=="linux")return false;
 try{
  const ancestors=new Set();let current=pid;for(let n=0;n<16&&current>1;n++){ancestors.add(current);const record=read(`/proc/${current}/stat`,"utf8");current=Number(record.slice(record.lastIndexOf(")")+2).split(/\s+/)[1]);}
  const locks=read("/proc/locks","utf8");
  return files.every(file=>{if(![HOST_PATHS.admissionLock,HOST_PATHS.deployLock,HOST_PATHS.maintenanceLock].includes(file))return false;const meta=stat(file);if(!meta.isFile()||meta.isSymbolicLink()||realpath(file)!==file||(meta.mode&0o022)!==0)return false;const dev=BigInt(meta.dev),major=((dev>>8n)&0xfffn)|((dev>>32n)&0xfffff000n),minor=(dev&0xffn)|((dev>>12n)&0xffffff00n);
   return [...locks.matchAll(/^\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+(\d+)\s+([a-f0-9]+):([a-f0-9]+):(\d+)\s/gmi)].some(match=>ancestors.has(Number(match[1]))&&BigInt(`0x${match[2]}`)===major&&BigInt(`0x${match[3]}`)===minor&&BigInt(match[4])===BigInt(meta.ino));});
 }catch{return false;}
}
export function hostLockArguments(files,nodePath,entry,args){
 const order=[HOST_PATHS.admissionLock,HOST_PATHS.deployLock,HOST_PATHS.maintenanceLock];if(!files.length||files.some(file=>!order.includes(file))||files.length!==new Set(files).size||files.some((file,index)=>index&&order.indexOf(file)<=order.indexOf(files[index-1])))throw new Error("HOST_LOCK_ORDER_INVALID");
 const tail=[nodePath,entry,...args];for(const file of [...files].reverse())tail.unshift("/usr/bin/flock","--nonblock","--exclusive","--conflict-exit-code=73",file);return tail;
}
export function reexecWithHostLocks(files,entry,args){
 if(hostLocksHeld(files))return null;
 for(const file of files){const meta=lstatSync(file);if(!meta.isFile()||meta.isSymbolicLink()||realpathSync(file)!==file||(meta.mode&0o022)!==0)throw new Error("HOST_LOCK_METADATA_INVALID");}
 const [command,...argv]=hostLockArguments(files,process.execPath,entry,args),result=spawnSync(command,argv,{stdio:"inherit",env:process.env,windowsHide:true});
 if(result.error)throw new Error("HOST_LOCK_FAILED");return result.status??1;
}

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function builderReplacementPlan(snapshot,contract=HOST_CONTRACT){
 const image=parseBuilderOptions(snapshot.inspect).get("image");
 if(!/^moby\/buildkit:v\d+\.\d+\.\d+$/.test(image??""))throw new Error("BUILDER_IMAGE_IDENTITY_INVALID");
 validateOwnedBuilder({...snapshot,image});
 if(image===contract.builder.image)throw new Error("BUILDER_ALREADY_CURRENT");
 const body={schemaVersion:1,contractRevision:contract.revision,builder:contract.builder.name,driver:"docker-container",network:"host",previousImage:image,targetImage:contract.builder.image,configSha256:snapshot.fingerprint,markerSha256:sha256(JSON.stringify(snapshot.marker)),previousOperationId:snapshot.marker.hostOperationId??null,proxySha256:snapshot.proxy?sha256(snapshot.proxy):null,cacheLossAcknowledgement:"I approve possible loss of CRM BuildKit cache; no data volumes or application images may be removed"};
 return{...body,approvalSha256:sha256(JSON.stringify(body))};
}
export function validateUpgradeJournal(journal,plan){
 if(journal?.schemaVersion!==1||!same(journal.plan,plan)||!/^[0-9a-f-]{36}$/.test(journal.operationId??"")||!Array.isArray(journal.events)||!journal.events.length||journal.events.some((event,index)=>event.sequence!==index+1)||!['APPROVED','REMOVE_INTENT','REMOVED','CREATE_INTENT','CREATED','MARKER_INTENT','COMPLETE'].includes(journal.stage))throw new Error("HOST_UPGRADE_JOURNAL_INVALID");
 const stages=['APPROVED','REMOVE_INTENT','REMOVED','CREATE_INTENT','CREATED','MARKER_INTENT','COMPLETE'];if(journal.events.some((event,index)=>event.stage!==stages[index])||journal.events.at(-1).stage!==journal.stage)throw new Error("HOST_UPGRADE_JOURNAL_INVALID");
 return journal;
}
// Adapter operations execute only while both fixed host locks are held. Each intent is durable
// before its destructive command. A resume inspects uncertainty; it never repeats a removal.
export async function replaceOwnedBuilder({plan,approval,acknowledgeCacheLoss=false,resumeId=null,operations}){
 if(approval!==plan.approvalSha256||acknowledgeCacheLoss!==true)throw new Error("HOST_UPGRADE_APPROVAL_REQUIRED");
 const {approvalSha256,...body}=plan;if(sha256(JSON.stringify(body))!==approvalSha256||plan.builder!=="lumina-crm-buildkit"||plan.targetImage!==HOST_CONTRACT.builder.image)throw new Error("HOST_UPGRADE_PLAN_INVALID");
 return operations.exclusive(async()=>{
  let journal=await operations.readActive();
  if(journal){validateUpgradeJournal(journal,plan);if(resumeId!==journal.operationId)throw new Error("HOST_UPGRADE_RESUME_REQUIRED");}
  else{if(resumeId)throw new Error("HOST_UPGRADE_OPERATION_MISSING");const observed=await operations.snapshot();if(!same(builderReplacementPlan(observed),plan))throw new Error("HOST_UPGRADE_PLAN_STALE");journal={schemaVersion:1,operationId:randomUUID(),plan,stage:"APPROVED",events:[]};}
  const save=async stage=>{journal={...journal,stage,events:[...journal.events,{sequence:journal.events.length+1,stage,at:new Date().toISOString()}]};await operations.persist(journal);};
  if(!journal.events.length)await save("APPROVED");
  let observed=await operations.snapshot({allowMissing:true});
  if(journal.stage==="APPROVED"){
   if(!same(builderReplacementPlan(observed),plan))throw new Error("HOST_UPGRADE_PLAN_STALE");
   await save("REMOVE_INTENT");await operations.removeOwned(observed);await save("REMOVED");observed=await operations.snapshot({allowMissing:true});
  }
  if(journal.stage==="REMOVE_INTENT"){
   if(observed.inspect)throw new Error("HOST_UPGRADE_REMOVAL_AMBIGUOUS: inspect manually; never repeat deletion");
   await save("REMOVED");
  }
  if(journal.stage==="REMOVED"){
   if(observed.inspect)throw new Error("HOST_UPGRADE_UNEXPECTED_BUILDER");
   await save("CREATE_INTENT");await operations.createOwned(journal.operationId);await save("CREATED");observed=await operations.snapshot({allowMissing:true});
  }
  if(journal.stage==="CREATE_INTENT"){
   if(!observed.inspect){await operations.createOwned(journal.operationId);observed=await operations.snapshot({allowMissing:true});}
   // The unique driver nonce proves this is our replacement, not an unowned namesake.
   validateOwnedBuilder({...observed,marker:operations.targetMarker(journal),image:plan.targetImage,operationId:journal.operationId});await save("CREATED");
  }
  if(journal.stage==="CREATED"||journal.stage==="MARKER_INTENT"){
   validateOwnedBuilder({...observed,marker:operations.targetMarker(journal),image:plan.targetImage,operationId:journal.operationId});
   await operations.verifyReplacement(journal);
   if(journal.stage!=="MARKER_INTENT")await save("MARKER_INTENT");
   await operations.writeMarker(operations.targetMarker(journal));await save("COMPLETE");
  }
  if(journal.stage==="COMPLETE"){
   validateOwnedBuilder({...await operations.snapshot(),image:plan.targetImage,operationId:journal.operationId});
   await operations.finish(journal);return journal;
  }
  throw new Error("HOST_UPGRADE_RECOVERY_REQUIRED");
 });
}
