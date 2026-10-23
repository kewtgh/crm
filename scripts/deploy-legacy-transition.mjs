#!/usr/bin/env node
// Independently reviewed repair CLI. It may run from a staging checkout: it never
// imports or executes target-commit programs and never starts application services.
import {existsSync,lstatSync,mkdirSync,realpathSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {HOST_PATHS,HOST_COMPATIBILITY,sha256} from "../deploy/libexec/lumina-host-contract.mjs";
import {hostLocksHeld,reexecWithHostLocks} from "../deploy/libexec/lumina-host-upgrade.mjs";
import {assertDeploymentRuntime} from "./lib/deployment-runtime.mjs";
import {assertHostPreflight,readStaticHostTarget} from "./lib/host-preflight.mjs";
import {legacyTransitionPlan,archiveLegacyTransition} from "./lib/legacy-transition-archive.mjs";
import {TRANSITION_EVIDENCE_ROOT,hostRead,trustedRead,durableText,captureTransitionJournal,transitionToolHash,collectTransitionEvidence,fileArchiveOperations,assertNoIncompleteLegacyArchives,assertNoIncompleteSourceAdoptions,describeTransitionFailure,serviceObservation} from "./lib/legacy-transition-host.mjs";

const entry=fileURLToPath(import.meta.url),root=path.resolve(path.dirname(entry),"..");
export async function sourceAdoptionPlan({target,toolSha256,run=hostRead,preflight=assertHostPreflight,executionLockHeld=false}){
 if(!/^[0-9a-f]{40}$/.test(target??""))throw new Error("TRANSITION_TARGET_INVALID");
 const git=args=>run("git",args,{cwd:HOST_PATHS.source}).trim();
 const before=git(["rev-parse","HEAD"]);
 if(git(["branch","--show-current"])!=="main"||!["git@github.com:kewtgh/crm.git","https://github.com/kewtgh/crm.git"].includes(git(["remote","get-url","origin"]))||git(["status","--porcelain"]))throw new Error("TRANSITION_SOURCE_NOT_CLEAN_APPROVED_MAIN");
 if(before!==target&&!Object.hasOwn(HOST_COMPATIBILITY.revisions,before))throw new Error("TRANSITION_SOURCE_NOT_AUDITED");
 git(["merge-base","--is-ancestor",before,target]);git(["merge-base","--is-ancestor",target,"origin/main"]);
 const staticTarget=await readStaticHostTarget((args)=>run("git",args,{cwd:HOST_PATHS.source}),target);
 if(!staticTarget.contract.controlPlane?.supportedHandoffProtocols?.includes(2))throw new Error("TRANSITION_TARGET_PROTOCOL_UNSUPPORTED");
 preflight({target:staticTarget,executionLockHeld});
 const body={schemaVersion:1,kind:"SOURCE_ONLY_ADOPTION",before,target,toolSha256,contractSha256:sha256(JSON.stringify(staticTarget.contract)),bundleDigest:staticTarget.bundle.digest};
 return{...body,approvalSha256:sha256(JSON.stringify(body))};
}
export async function main(argv=process.argv.slice(2)){
 const [action,...args]=argv,values=new Map();for(const arg of args){const match=/^--([a-z-]+)(?:=([^\s]+))?$/.exec(arg);if(!match||values.has(match[1]))throw new Error("TRANSITION_ARGUMENT_INVALID");values.set(match[1],match[2]??true);}
 if(!["journal","archive","adopt"].includes(action))throw new Error("Use journal --invocation=ID [--capture], archive --request=UUID --invocation=ID [--approve=SHA256], or adopt --target=SHA [--approve=SHA256 --operation=UUID]");
 const permitted={journal:["invocation","capture"],archive:["request","invocation","approve"],adopt:["target","approve","operation"]}[action];if([...values.keys()].some(key=>!permitted.includes(key)))throw new Error("TRANSITION_ARGUMENT_INVALID");
 if(process.platform!=="linux")throw new Error("TRANSITION_REQUIRES_LINUX");
 assertDeploymentRuntime();const uid=process.getuid(),toolSha256=transitionToolHash(root);
 if(action==="journal"){
  const invocationId=values.get("invocation");if(!/^[0-9a-f]{32}$/.test(invocationId??""))throw new Error("TRANSITION_INVOCATION_INVALID");
  if(!values.has("capture")){console.log(JSON.stringify({readOnly:true,invocationId,toolSha256,requiresRoot:true,output:`${TRANSITION_EVIDENCE_ROOT}/${invocationId}.json`,approval:"The operator must review this repair checkout before running journal --capture as root."},null,2));return;}
  if(uid!==0)throw new Error("TRANSITION_JOURNAL_CAPTURE_REQUIRES_ROOT");
  const journal=captureTransitionJournal(invocationId,toolSha256);if(!["failed","inactive"].includes(journal.service.activeState))throw new Error("TRANSITION_SERVICE_ACTIVE");
  if(!existsSync(TRANSITION_EVIDENCE_ROOT))mkdirSync(TRANSITION_EVIDENCE_ROOT,{mode:0o755});
  const meta=lstatSync(TRANSITION_EVIDENCE_ROOT);if(meta.uid!==0||!meta.isDirectory()||meta.isSymbolicLink()||(meta.mode&0o022)!==0||realpathSync(TRANSITION_EVIDENCE_ROOT)!==TRANSITION_EVIDENCE_ROOT)throw new Error("TRANSITION_ROOT_ATTESTATION_DIRECTORY_INVALID");
  // Evidence is not secret-free; keep root ownership and allow only the CRM group.
  // The operator provisions the directory group and grants read access separately.
  durableText(`${TRANSITION_EVIDENCE_ROOT}/${invocationId}.json`,`${JSON.stringify(journal)}\n`,{exclusive:true});
  console.log("TRANSITION_JOURNAL_CAPTURED: grant lumina-crm read-only ACL on this root-owned evidence file");return;
 }
 if(uid===0||hostRead("/usr/bin/id",["-un"]).trim()!=="lumina-crm")throw new Error("TRANSITION_REQUIRES_CRM_ACCOUNT");
 if(values.has("approve")){
  const locks=[HOST_PATHS.admissionLock,HOST_PATHS.deployLock,...(action==="archive"?[HOST_PATHS.maintenanceLock]:[])];
  const status=reexecWithHostLocks(locks,entry,argv);if(status!==null){process.exitCode=status;return;}
  if(!hostLocksHeld(locks))throw new Error("TRANSITION_LOCK_REQUIRED");
 }
 if(action==="archive"){
  const options={requestId:values.get("request"),invocationId:values.get("invocation"),toolSha256},evidence=collectTransitionEvidence(options),plan=legacyTransitionPlan(evidence);
  if(!values.has("approve")){console.log(JSON.stringify(plan,null,2));return;}
  console.log(JSON.stringify(await archiveLegacyTransition({plan,approval:values.get("approve"),operations:fileArchiveOperations(options)}),null,2));return;
 }
 if(existsSync(`${HOST_PATHS.state}/request.json`))throw new Error("TRANSITION_PENDING_REQUEST_MUST_BE_AUDITED_FIRST");
 assertNoIncompleteLegacyArchives();assertNoIncompleteSourceAdoptions(HOST_PATHS.state,{except:values.has("operation")?`source-adoption-${values.get("operation")}.json`:null});if(!["failed","inactive"].includes(serviceObservation().activeState))throw new Error("TRANSITION_SERVICE_ACTIVE");
 const target=values.get("target"),plan=await sourceAdoptionPlan({target,toolSha256,executionLockHeld:values.has("approve")});
 if(!values.has("approve")){console.log(JSON.stringify(plan,null,2));return;}
 const operation=values.get("operation");if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(operation??""))throw new Error("TRANSITION_OPERATION_UUID_REQUIRED");
 const file=`${HOST_PATHS.state}/source-adoption-${operation}.json`,prior=existsSync(file)?JSON.parse(trustedRead(file,uid)):null;
 if(prior){const {approvalSha256,...body}=prior.plan;if(sha256(JSON.stringify(body))!==approvalSha256||!["APPROVED","FAST_FORWARD_INTENT","COMPLETE"].includes(prior.stage))throw new Error("TRANSITION_ADOPTION_LEDGER_INVALID");if(prior.plan.target!==plan.target||prior.plan.toolSha256!==toolSha256||prior.plan.contractSha256!==plan.contractSha256||prior.plan.approvalSha256!==values.get("approve")||![prior.plan.before,prior.plan.target].includes(plan.before))throw new Error("TRANSITION_ADOPTION_RESUME_CONFLICT");}
 else if(values.get("approve")!==plan.approvalSha256)throw new Error("TRANSITION_ADOPTION_APPROVAL_REQUIRED");
 let ledger=prior??{schemaVersion:1,plan,stage:"APPROVED",events:[]};
 const save=stage=>{ledger={...ledger,stage,events:[...ledger.events,{stage,at:new Date().toISOString()}]};durableText(file,`${JSON.stringify(ledger)}\n`);};
 if(ledger.stage!=="COMPLETE"){
  save("FAST_FORWARD_INTENT");if(plan.before!==target)hostRead("git",["-c","core.hooksPath=/dev/null","merge","--ff-only",target],{cwd:HOST_PATHS.source});
  if(hostRead("git",["rev-parse","HEAD"],{cwd:HOST_PATHS.source}).trim()!==target)throw new Error("TRANSITION_ADOPTION_HEAD_MISMATCH");save("COMPLETE");
 }
 console.log(JSON.stringify({stage:ledger.stage,target,applicationDeploymentStarted:false,requestCreated:false},null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===entry){try{await main();}catch(error){console.error(JSON.stringify(describeTransitionFailure(error)));process.exitCode=1;}}
