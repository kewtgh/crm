import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,cpSync,rmSync,readdirSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";
import {HOST_COMPATIBILITY,HOST_PATHS,sha256,maintenanceBundle} from "../deploy/libexec/lumina-host-contract.mjs";
import {inspectMaintenanceTrust,trustedUnit} from "../scripts/lib/host-trust.mjs";
const repository=fileURLToPath(new URL("..",import.meta.url));
const legacy="796cc43e63784eb8891ca6420572cd563cb2ac80",target="b".repeat(40),uid=1001,invocation="f".repeat(32);
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`,clone=value=>JSON.parse(JSON.stringify(value));
const git=(args,cwd=repository)=>{const result=spawnSync("git",args,{cwd,encoding:"utf8",timeout:10000,maxBuffer:8_000_000});assert.equal(result.status,0,result.stderr);return result.stdout;};
test("only catalogued root-owned standalone maintenance and units are legacy supported",()=>{
 for(const commit of Object.keys(HOST_COMPATIBILITY.revisions)){
  const source=git(["show",`${commit}:deploy/libexec/lumina-crm-storage-maintenance.mjs`]);const profile=HOST_COMPATIBILITY.revisions[commit];
  if(!profile.bundle)assert.equal(inspectMaintenanceTrust(file=>{assert.equal(file,HOST_PATHS.program);return source;}).trust,"LEGACY_SUPPORTED");
  else{assert.throws(()=>inspectMaintenanceTrust(()=>source),/NOT_REVIEWED/);const assets=Object.fromEntries(profile.bundle.paths.map(file=>[file,git(["show",`${commit}:${file}`])])),bundle=maintenanceBundle(assets,profile.bundle.paths),files=new Map([[HOST_PATHS.program,bundle.launcher],[`${HOST_PATHS.bundles}/installed.json`,JSON.stringify({schemaVersion:1,stage:"COMPLETE",bundleDigest:bundle.digest,launcherSha256:bundle.launcherSha256})],...profile.bundle.paths.map(file=>[`${HOST_PATHS.bundles}/${bundle.digest}/${path.basename(file)}`,assets[file]])]);assert.equal(bundle.digest,profile.bundle.digest);assert.equal(inspectMaintenanceTrust(file=>{if(!files.has(file))throw Error("untrusted fixture");return files.get(file);}).trust,"LEGACY_SUPPORTED");}
  assert.throws(()=>inspectMaintenanceTrust(()=>source+"\n// unknown code"),/NOT_REVIEWED/);
  const unit=git(["show",`${commit}:deploy/systemd/lumina-crm-deploy.service`]);assert.equal(trustedUnit("lumina-crm-deploy.service",unit,"different new unit"),true);assert.equal(trustedUnit("lumina-crm-deploy.service",unit+"\nEnvironment=UNKNOWN=1","different new unit"),false);
 }
});
function handoff(){
 const request={requestId:id(1),launchId:id(2),mode:"deploy",sourceRoot:"/opt/lumina-crm/source"};
 const latest={...request,result:"BOOTSTRAP_RUNNING",stage:"target-controller-start",controllerStarted:true,deploymentId:null,applicationResult:"NOT_STARTED",migrationState:"NOT_STARTED",migrationMayHaveChanged:false,webSwitch:"NOT_STARTED",workerSwitch:"NOT_STARTED",applicationAccepted:false,finalizationComplete:false,requestArchived:false,bootstrapCommit:legacy,targetCommit:target,attempts:[{attemptId:id(3),controllerStarted:true,startedAt:"2026-10-24T00:00:00.000Z"}]};
 return{request,latest,bootstrap:clone(latest),launch:{bootstrapSource:legacy,expectedTarget:target,bootstrapPid:200},parent:{pid:200,ppid:100,uid,exe:"/usr/bin/node",argv:["/usr/bin/node",path.join("/opt/lumina-crm/source","scripts/deploy-production-bootstrap.mjs")],start:20,cgroup:"/system.slice/lumina-crm-deploy.service"},child:{pid:201,ppid:200,uid,exe:"/usr/bin/node",start:30,cgroup:"/system.slice/lumina-crm-deploy.service"},service:{mainPid:100,mainStart:10,user:"lumina-crm",activeState:"active",invocationId:invocation,controlGroup:"/system.slice/lumina-crm-deploy.service"},source:{head:target,clean:true,branch:"main",origin:"https://github.com/kewtgh/crm.git"},sourceHashes:{bootstrap:HOST_COMPATIBILITY.revisions[legacy].files["scripts/deploy-production-bootstrap.mjs"]},transition:{previousHead:legacy,fastForward:true,at:1000,parentStartedAt:0,childStartedAt:2000},stateMetadataVerified:true,unitVerified:true,lockHeld:true,uid,sourceRoot:request.sourceRoot,invocationId:invocation};
}
test("genuine 796cc43 Bootstrap source launches current controller entry in a real child without new handoff fields",async t=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),"crm-cross-commit-"));t.after(()=>rmSync(directory,{recursive:true,force:true,maxRetries:3,retryDelay:50}));
 const oldRoot=path.join(directory,"old"),sourceRoot=path.join(directory,"target"),state=path.join(directory,"state");for(const dir of [oldRoot,state])mkdirSync(dir);
 git(["-c","core.autocrlf=false","clone","--shared","--no-checkout",repository,sourceRoot]);git(["-c","core.autocrlf=false","checkout","-B","main",legacy],sourceRoot);git(["remote","set-url","origin","https://github.com/kewtgh/crm.git"],sourceRoot);
 const archive=path.join(directory,"old.tar");git(["-c","core.autocrlf=false","archive","--format=tar",`--output=${archive}`,legacy,"scripts","deploy/libexec","package.json",".nvmrc"]);
 const unpack=spawnSync("tar",["-xf",archive,"-C",oldRoot],{timeout:10000,encoding:"utf8"});assert.equal(unpack.status,0,unpack.stderr);
 cpSync(path.join(repository,"scripts/lib"),path.join(sourceRoot,"scripts/lib"),{recursive:true});cpSync(path.join(repository,"deploy/libexec"),path.join(sourceRoot,"deploy/libexec"),{recursive:true});
 writeFileSync(path.join(sourceRoot,"package.json"),JSON.stringify({version:"3.40.0",type:"module"}));
 const context=handoff();context.sourceRoot=sourceRoot;context.request.sourceRoot=sourceRoot;context.parent.exe=process.execPath;context.parent.argv=[process.execPath,path.join(sourceRoot,"scripts/deploy-production-bootstrap.mjs")];context.parent.pid=process.pid;context.launch.bootstrapPid=process.pid;context.child.ppid=process.pid;context.child.exe=process.execPath;
 writeFileSync(path.join(sourceRoot,"context.json"),JSON.stringify(context));
 // Linux /proc, root-owned units and systemd observations use a platform adapter.
 // The old source, its durable bootstrap records, target SHA, child PID/PPID,
 // argv, environment, entry implementation and receipt are real, not mocked.
 const runner=`import {readFileSync,writeFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';import {runControllerEntry} from './lib/controller-entry.mjs';import {parseTargetControllerArguments} from './lib/target-controller-source.mjs';const state=process.env.CRM_TEST_STATE;const context=JSON.parse(readFileSync('context.json'));context.launch=parseTargetControllerArguments(process.argv.slice(2));context.request=JSON.parse(readFileSync(state+'/request.json'));context.latest=JSON.parse(readFileSync(state+'/latest.json'));context.bootstrap=JSON.parse(readFileSync(state+'/bootstrap-'+context.request.requestId+'-'+context.latest.attempts.at(-1).attemptId+'.json'));context.child.pid=process.pid;context.child.ppid=process.ppid;context.source.head=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim();context.transition.previousHead=spawnSync('git',['rev-parse','HEAD@{1}'],{encoding:'utf8'}).stdout.trim();context.transition.fastForward=spawnSync('git',['reflog','-1','--format=%gs'],{encoding:'utf8'}).stdout.includes(': Fast-forward');if(process.env.LUMINA_BOOTSTRAP_ATTEMPT_ID||process.env.LUMINA_HOST_HANDOFF_NONCE)throw Error('old Bootstrap unexpectedly passed modern fields');const receipt=await runControllerEntry({request:context.request,legacyContext:context,stateRoot:state,preflight:()=>{},validateSource:()=>{if(context.source.head!==context.launch.expectedTarget)throw Error('SHA changed');}});writeFileSync(state+'/business-entry.json',JSON.stringify(receipt));`;
 writeFileSync(path.join(sourceRoot,"scripts/deploy-production-runner.mjs"),runner);
 git(["-c","core.autocrlf=false","add","."],sourceRoot);git(["-c","user.name=Fixture","-c","user.email=fixture@example.invalid","commit","-m","fictional cross-version target"],sourceRoot);const targetSha=git(["rev-parse","HEAD"],sourceRoot).trim();git(["update-ref","refs/remotes/origin/main",targetSha],sourceRoot);git(["-c","core.autocrlf=false","reset","--hard",legacy],sourceRoot);
 const oldModule=await import(pathToFileURL(path.join(oldRoot,"scripts/deploy-production-bootstrap.mjs")).href);assert.equal(sha256(readFileSync(path.join(oldRoot,"scripts/deploy-production-bootstrap.mjs"))),context.sourceHashes.bootstrap);
 const requestPath=path.join(state,"request.json");writeFileSync(requestPath,JSON.stringify(context.request));
 const code=await oldModule.runBootstrap({requestPath,sourceRoot,updateSource:()=>oldModule.updateSourceAndResolveTarget({git:async args=>args[0]==="fetch"?"":git(args,sourceRoot).trim()}),spawnController:options=>oldModule.spawnTargetController({...options,nodePath:process.execPath,environment:{...process.env,CRM_TEST_STATE:state}})});
 assert.equal(code,0);const receipt=JSON.parse(readFileSync(path.join(state,"business-entry.json")));assert.equal(receipt.handoffProtocol,0);assert.equal(receipt.targetCommit,targetSha);assert.equal(receipt.bootstrapPid,process.pid);assert.equal(receipt.outcome,"ADMITTED");assert.equal(readdirSync(state).filter(name=>name.startsWith("legacy-entry-")).length,1);
});
