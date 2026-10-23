#!/usr/bin/env node
import {readFileSync,lstatSync,realpathSync,existsSync,mkdirSync,openSync,writeFileSync,closeSync,fsyncSync,renameSync,chmodSync} from "node:fs";
import {randomUUID} from "node:crypto";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {HOST_PATHS,MAINTENANCE_ASSETS,maintenanceBundle,sha256} from "../deploy/libexec/lumina-host-contract.mjs";
import {reexecWithHostLocks,hostLocksHeld} from "../deploy/libexec/lumina-host-upgrade.mjs";

const installerSha256=sha256(readFileSync(fileURLToPath(import.meta.url)));
export function maintenanceInstallPlan(assets,previousLauncher){const bundle=maintenanceBundle(assets);const plan={schemaVersion:1,installerSha256,bundleDigest:bundle.digest,previousSha256:previousLauncher===null?null:sha256(previousLauncher),launcherSha256:bundle.launcherSha256,assets:bundle.hashes};return{...plan,approvalSha256:sha256(JSON.stringify(plan))};}
export async function installMaintenance({assets,plan,approval,resumeId=null,operations}){
 const bundle=maintenanceBundle(assets),{approvalSha256,...body}=plan;
 if(approval!==approvalSha256||approvalSha256!==sha256(JSON.stringify(body))||plan.installerSha256!==installerSha256||plan.bundleDigest!==bundle.digest||plan.launcherSha256!==bundle.launcherSha256||JSON.stringify(plan.assets)!==JSON.stringify(bundle.hashes))throw new Error("MAINTENANCE_INSTALL_APPROVAL_REQUIRED");
 return operations.exclusive(async()=>{
  let journal=resumeId?await operations.readJournal(resumeId):null;
  if(resumeId&&(!journal||journal.operationId!==resumeId||JSON.stringify(journal.plan)!==JSON.stringify(plan)||!["APPROVED","BUNDLE_VERIFIED","ACTIVATION_INTENT","COMPLETE"].includes(journal.stage)))throw new Error("MAINTENANCE_INSTALL_RESUME_INVALID");
  const current=await operations.readLauncher(),currentHash=current===null?null:sha256(current);
  if(currentHash!==plan.previousSha256&&!(journal&&currentHash===bundle.launcherSha256))throw new Error("MAINTENANCE_INSTALL_SOURCE_CHANGED");
  journal??={schemaVersion:1,operationId:randomUUID(),plan,stage:"APPROVED",events:[]};
  const save=async stage=>{journal={...journal,stage,events:[...journal.events,{stage,at:new Date().toISOString()}]};await operations.persist(journal);};
  if(!journal.events.length)await save("APPROVED");
  await operations.stageBundle(bundle,assets);await save("BUNDLE_VERIFIED");
  await save("ACTIVATION_INTENT");
  if(currentHash!==bundle.launcherSha256){await operations.preservePrevious(journal,current);await operations.activate(bundle.launcher);}
  if(sha256(await operations.readLauncher())!==bundle.launcherSha256)throw new Error("MAINTENANCE_INSTALL_VERIFICATION_FAILED");
  await save("COMPLETE");await operations.writeReceipt({schemaVersion:1,stage:"COMPLETE",operationId:journal.operationId,bundleDigest:bundle.digest,launcherSha256:bundle.launcherSha256});return journal;
 });
}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
function rootFile(file){const meta=lstatSync(file);if(!meta.isFile()||meta.isSymbolicLink()||meta.uid!==0||(meta.mode&0o022)!==0||realpathSync(file)!==file)throw new Error("MAINTENANCE_ROOT_FILE_INVALID");return readFileSync(file,"utf8");}
function rootDirectory(file){const meta=lstatSync(file);if(!meta.isDirectory()||meta.isSymbolicLink()||meta.uid!==0||(meta.mode&0o022)!==0||realpathSync(file)!==file)throw new Error("MAINTENANCE_ROOT_DIRECTORY_INVALID");}
function atomicRootWrite(file,text,mode){const temp=`${file}.next-${randomUUID()}`;const fd=openSync(temp,"wx",mode);try{writeFileSync(fd,text);fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,file);const directory=openSync(path.dirname(file),"r");try{fsyncSync(directory);}finally{closeSync(directory);}}
async function main(){
 const args=process.argv.slice(2);if(args.some(value=>!value.startsWith("--approve=")&&!value.startsWith("--resume=")))throw new Error("MAINTENANCE_INSTALL_ARGUMENT_INVALID");
 const assets=Object.fromEntries(MAINTENANCE_ASSETS.map(file=>[file,readFileSync(path.join(root,file),"utf8")]));
 const previous=existsSync(HOST_PATHS.program)?rootFile(HOST_PATHS.program):null;
 const approval=args.find(value=>value.startsWith("--approve="))?.slice(10),resumeId=args.find(value=>value.startsWith("--resume="))?.slice(9)??null;
 if(!approval){if(resumeId)throw new Error("MAINTENANCE_INSTALL_APPROVAL_REQUIRED");process.stdout.write(`${JSON.stringify(maintenanceInstallPlan(assets,previous),null,2)}\n`);return;}
 if(process.platform!=="linux"||process.getuid?.()!==0)throw new Error("MAINTENANCE_INSTALL_REQUIRES_ROOT_OPERATOR");
 if(resumeId&&!/^[0-9a-f-]{36}$/.test(resumeId))throw new Error("MAINTENANCE_INSTALL_RESUME_INVALID");
 const locks=[HOST_PATHS.admissionLock,HOST_PATHS.deployLock,HOST_PATHS.maintenanceLock];const exit=reexecWithHostLocks(locks,fileURLToPath(import.meta.url),args);if(exit!==null){process.exitCode=exit;return;}
 const journalRoot="/var/log/lumina-crm-host-install";
 rootDirectory("/usr/local/libexec");rootDirectory("/var/log");
 rootFile(fileURLToPath(import.meta.url));for(const file of MAINTENANCE_ASSETS)rootFile(path.join(root,file));
 const previousJournal=resumeId?JSON.parse(rootFile(`${journalRoot}/${resumeId}.json`)):null;
 const plan=previousJournal?.plan??maintenanceInstallPlan(assets,previous);
 if(approval!==plan.approvalSha256)throw new Error("MAINTENANCE_INSTALL_APPROVAL_REQUIRED");
 if(!existsSync(journalRoot))mkdirSync(journalRoot,{mode:0o700});rootDirectory(journalRoot);
 const result=await installMaintenance({assets,plan,approval,resumeId,operations:{
  exclusive:async fn=>{if(!hostLocksHeld(locks))throw new Error("MAINTENANCE_INSTALL_LOCK_REQUIRED");return fn();},
  readJournal:async()=>previousJournal,
  readLauncher:async()=>existsSync(HOST_PATHS.program)?rootFile(HOST_PATHS.program):null,
  persist:async journal=>atomicRootWrite(`${journalRoot}/${journal.operationId}.json`,`${JSON.stringify(journal,null,2)}\n`,0o600),
  preservePrevious:async(journal,text)=>{if(text!==null)atomicRootWrite(`${journalRoot}/${journal.operationId}.previous.mjs`,text,0o600);},
  stageBundle:async(bundle,files)=>{
   if(!existsSync(HOST_PATHS.bundles))mkdirSync(HOST_PATHS.bundles,{mode:0o755});rootDirectory(HOST_PATHS.bundles);
   const target=`${HOST_PATHS.bundles}/${bundle.digest}`;
   if(!existsSync(target)){const temporary=`${HOST_PATHS.bundles}/.install-${randomUUID()}`;mkdirSync(temporary,{mode:0o700});for(const [file,text] of Object.entries(files))atomicRootWrite(path.join(temporary,path.basename(file)),text,0o444);chmodSync(temporary,0o755);renameSync(temporary,target);}
   rootDirectory(target);for(const file of MAINTENANCE_ASSETS)if(sha256(rootFile(path.join(target,path.basename(file))))!==bundle.hashes[file])throw new Error("MAINTENANCE_BUNDLE_CONTENT_MISMATCH");
  },
  activate:async launcher=>atomicRootWrite(HOST_PATHS.program,launcher,0o755),
  writeReceipt:async receipt=>atomicRootWrite(`${HOST_PATHS.bundles}/installed.json`,`${JSON.stringify(receipt,null,2)}\n`,0o644),
 }});process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{await main();}catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}}
