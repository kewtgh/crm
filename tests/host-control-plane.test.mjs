import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {mkdtemp,mkdir,writeFile,readFile,rm,rename} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {EventEmitter} from "node:events";
import {spawnSync} from "node:child_process";
import {HOST_CONTRACT,HOST_PATHS,HOST_CONTRACT_PATH,MAINTENANCE_ASSETS,componentDiagnostic,sha256,validateOwnedBuilder,maintenanceBundle} from "../deploy/libexec/lumina-host-contract.mjs";
import {builderReplacementPlan,replaceOwnedBuilder,hostLocksHeld,hostLockArguments} from "../deploy/libexec/lumina-host-upgrade.mjs";
import {localHostTarget,readStaticHostTarget,evaluateHostSnapshot,collectHostSnapshot,hostUpgradePlan} from "../scripts/lib/host-preflight.mjs";
import {maintenanceInstallPlan,installMaintenance} from "../scripts/install-host-maintenance.mjs";
import {REQUIRED_DOCKER_CAPABILITIES} from "../scripts/lib/host-capabilities.mjs";
import {runControllerEntry,controllerEntryIdentity,validateEarlyRejection} from "../scripts/lib/controller-entry.mjs";
import {earlyArchivePlan,archiveEarlyRequest,assertNoIncompleteEarlyArchive} from "../scripts/lib/early-request-archive.mjs";
import {runBootstrap,spawnTargetController,updateSourceAndResolveTarget} from "../scripts/deploy-production-bootstrap.mjs";
import {rootlessUserEnvironment} from "../scripts/lib/rootless-docker.mjs";

const clone=value=>JSON.parse(JSON.stringify(value));
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`,commit="a".repeat(40),next="b".repeat(40),endpoint="unix:///run/user/1001/docker.sock",fingerprint="f".repeat(64);
const assets=Object.fromEntries(MAINTENANCE_ASSETS.map(file=>[file,readFileSync(new URL(`../${file}`,import.meta.url),"utf8")]));
const target=localHostTarget();
function builder(image=HOST_CONTRACT.builder.image,nonce=null){return{endpoint,fingerprint,proxy:"",marker:{owner:"kewtgh/crm",builder:"lumina-crm-buildkit",driver:"docker-container",builderNetworkMode:"host",configSha256:fingerprint,dockerProxyEnabled:false,dockerProxySha256:null,...(nonce?{hostOperationId:nonce}:{})},inspect:`Name: lumina-crm-buildkit\nDriver: docker-container\nEndpoint: ${endpoint}\nDriver Options: network="host" image="${image}"${nonce?` env.LUMINA_HOST_OPERATION_ID="${nonce}"`:""}\n`,image};}
function ready(){return{versions:Object.fromEntries(Object.entries(HOST_CONTRACT.components).map(([key,value])=>[key,value.recommended])),systemdNode:"24.22.1",sameNode:true,identity:true,isolated:true,dockerServiceReady:true,builder:builder(),builderDaemon:{image:HOST_CONTRACT.builder.image,network:"host"},admissionLockReady:true,maintenanceTrust:{digest:target.bundle.digest,protocol:1,trust:"OPERATOR_APPROVED",builderImages:["moby/buildkit:v0.33.1","moby/buildkit:v0.34.1"],capabilities:["trusted-code"]},capabilities:{ready:true},unitsReady:true,deployLockFree:true,maintenanceLockFree:true,operationPending:false,diskReady:true,disk:[]};}

test("host versions preserve LTS/major boundaries and distinguish recommendations",()=>{
 for(const version of ["24.22.0","24.21.9","25.0.0","26.12.1","24.22.1-rc.1","garbage"])assert.equal(componentDiagnostic("node",version,HOST_CONTRACT.components.node).blocking,true,version);
 for(const version of ["24.22.1","24.22.2","24.23.0"])assert.equal(componentDiagnostic("node",version,HOST_CONTRACT.components.node).blocking,false,version);
 for(const version of ["12.2.0","13.0.0","12.2.1-beta.1"])assert.equal(componentDiagnostic("npm",version,HOST_CONTRACT.components.npm).blocking,true);
 assert.equal(componentDiagnostic("npm","12.2.2",HOST_CONTRACT.components.npm).blocking,false);
 for(const [name,version] of [["docker","29.8.2"],["compose","5.6.0"],["buildx","0.37.2"]])assert.equal(componentDiagnostic(name,version,HOST_CONTRACT.components[name]).status,"SUPPORTED");
 assert.equal(evaluateHostSnapshot(ready(),target).ready,true);
});

test("host diagnostics identify every blocking boundary without relaxing healthy components",()=>{
 for(const [patch,component] of [[{systemdNode:"24.22.0"},"systemd.node"],[{sameNode:false},"systemd.node.identity"],[{maintenanceTrust:null},"maintenance.bundle"],[{unitsReady:false},"systemd.units"],[{deployLockFree:false},"deployment.lock"],[{maintenanceLockFree:false},"maintenance.lock"],[{operationPending:true},"host.operation"],[{diskReady:false},"disk"],[{isolated:false},"docker.isolation"]]){
  const report=evaluateHostSnapshot({...ready(),...patch},target);assert.equal(report.ready,false);assert.equal(report.diagnostics.find(row=>row.component===component).blocking,true);assert.ok(hostUpgradePlan(report).requiredActions.length);
 }
 assert.equal(evaluateHostSnapshot({...ready(),deployLockFree:false},target,{executionLockHeld:true}).ready,true);
 assert.equal(evaluateHostSnapshot({...ready(),builder:builder("moby/buildkit:v0.32.0")},target).diagnostics.find(row=>row.component==="buildkit").blocking,true);
});

test("builder ownership rejects foreign endpoints, unknown owners, changed config/network/proxy and extra nodes",()=>{
 const original=builder();assert.ok(validateOwnedBuilder(original));
 for(const patch of [{marker:null},{marker:{...original.marker,owner:"other/project"}},{fingerprint:"0".repeat(64)},{endpoint:"unix:///run/user/2002/docker.sock"},{inspect:original.inspect.replace('network="host"','network="bridge"')},{inspect:original.inspect.replace('image="moby/buildkit:v0.34.1"','image="moby/buildkit:v0.33.1"')},{proxy:"http://proxy.example.test:8080"},{inspect:original.inspect+`Endpoint: ${endpoint}\n`}])assert.throws(()=>validateOwnedBuilder({...original,...patch}));
});

function collectorDouble(){
 const calls=[],values=new Map(),bundle=maintenanceBundle(assets);
 values.set("/etc/lumina-crm/deploy.env",`DOCKER_HOST=${endpoint}\nLUMINA_DOCKER_DATA_ROOT=${HOST_PATHS.dockerRoot}\n`);
 values.set(HOST_PATHS.buildkitConfig,readFileSync(new URL("../deploy/buildkitd.toml",import.meta.url),"utf8"));
 const observed=builder();observed.marker.configSha256=sha256(values.get(HOST_PATHS.buildkitConfig));
 values.set(`${HOST_PATHS.storage}/builder-owner.json`,JSON.stringify(observed.marker));values.set(HOST_PATHS.program,bundle.launcher);values.set(`${HOST_PATHS.bundles}/installed.json`,JSON.stringify({schemaVersion:1,stage:"COMPLETE",protocol:1,builderImages:["moby/buildkit:v0.33.1","moby/buildkit:v0.34.1"],capabilities:["trusted-code"],bundleDigest:bundle.digest,launcherSha256:bundle.launcherSha256}));
 for(const file of MAINTENANCE_ASSETS)values.set(`${HOST_PATHS.bundles}/${bundle.digest}/${path.basename(file)}`,assets[file]);
 for(const unit of ["lumina-crm.service","lumina-crm-deploy.service","lumina-crm-storage-prepare.service","lumina-crm-build-cache-cleanup.service","lumina-crm-storage-cleanup.service"]){const text=readFileSync(new URL(`../deploy/systemd/${unit}`,import.meta.url),"utf8");values.set(`/etc/systemd/system/${unit}`,text);values.set(path.join("fixture-source","deploy/systemd",unit),text);}
 const directories=[HOST_PATHS.dockerConfig,HOST_PATHS.buildxConfig,HOST_PATHS.dockerRoot],locks=[HOST_PATHS.admissionLock,HOST_PATHS.deployLock,HOST_PATHS.maintenanceLock];
 const missing=()=>{throw Object.assign(new Error("missing fixture"),{code:"ENOENT"});};
 const options={platform:"linux",uid:1001,accountHome:()=>"/home/fictional-deploy",executable:"/usr/bin/node",sourceRoot:"fixture-source",environment:{DOCKER_HOST:endpoint},
  read:file=>values.get(file)??missing(),realpath:file=>file,
  stat:file=>{if(!values.has(file)&&!directories.includes(file)&&!locks.includes(file)&&file!=="/run/user/1001/docker.sock")return missing();return{uid:file.endsWith("builder-owner.json")||directories.includes(file)||locks.includes(file)||file.endsWith("docker.sock")?1001:0,mode:directories.includes(file)?0o40700:file.endsWith("builder-owner.json")?0o100600:0o100644,isFile:()=>!directories.includes(file)&&!file.endsWith("docker.sock"),isDirectory:()=>directories.includes(file),isSocket:()=>file.endsWith("docker.sock"),isSymbolicLink:()=>false};},
  statfs:()=>({bavail:100_000_000,blocks:200_000_000,bsize:4096}),
  run:(command,args,env)=>{calls.push({command,args,env});let stdout="";if(command==="npm")stdout="12.2.1";else if(command==="/usr/bin/node")stdout="v24.22.1";else if(command==="/usr/bin/id")stdout="lumina-crm";else if(command==="/usr/bin/systemctl")stdout=args.includes("--user")?"LoadState=loaded\nActiveState=active":`LoadState=loaded\nNeedDaemonReload=no\nDropInPaths=\nUser=lumina-crm\nFragmentPath=/etc/systemd/system/${args[1]}`;else if(command==="/usr/bin/docker"){assert.equal(env.DOCKER_HOST,endpoint);assert.equal(env.DOCKER_CONFIG,HOST_PATHS.dockerConfig);assert.equal(env.BUILDX_CONFIG,HOST_PATHS.buildxConfig);if(args.includes("--help"))stdout=REQUIRED_DOCKER_CAPABILITIES.find(p=>JSON.stringify(p.args)===JSON.stringify(args)).flags.join(" ");else if(args.includes("--format")&&args.includes("json"))stdout=JSON.stringify({services:{web:{user:"10001:10001",init:true,read_only:true,cap_drop:["ALL"],security_opt:["no-new-privileges:true"],pids_limit:256,mem_limit:536870912,cpus:1,tmpfs:["/tmp:rw,noexec,nosuid,nodev"],networks:{backend:null},ports:[{host_ip:"127.0.0.1",target:3200,published:"3200",protocol:"tcp"}]}},networks:{backend:{internal:true}}});else if(args[0]==="container")stdout=JSON.stringify([{Config:{Image:HOST_CONTRACT.builder.image},HostConfig:{NetworkMode:"host"}}]);else if(args[0]==="info")stdout=JSON.stringify({ServerVersion:"29.9.2",DockerRootDir:HOST_PATHS.dockerRoot,CgroupDriver:"systemd",CgroupVersion:"2",SecurityOptions:["name=rootless"]});else if(args[0]==="compose")stdout="v5.6.1";else if(args[1]==="version")stdout="github.com/docker/buildx v0.38.1 fictional";else stdout=observed.inspect;}return{status:0,stdout};}
 };return{options,values,calls};
}
test("read-only collector validates root-owned installed bytes and fixed rootless configuration",()=>{
 const f=collectorDouble(),snapshot=collectHostSnapshot(f.options);assert.equal(evaluateHostSnapshot(snapshot,target).ready,true);
 assert.equal(f.calls.some(call=>!call.args.includes("--help")&&call.args.some(arg=>["create","start","rm","prune","up","merge"].includes(arg))),false);
 f.values.set(`${HOST_PATHS.bundles}/${target.bundle.digest}/lumina-host-contract.mjs`,"changed bytes");assert.equal(evaluateHostSnapshot(collectHostSnapshot(f.options),target).diagnostics.find(row=>row.component==="maintenance.bundle").blocking,true);
});
test("wrong user/socket/config never contacts a foreign Docker daemon",()=>{
 for(const environment of [{DOCKER_HOST:"unix:///run/user/2002/docker.sock"},{DOCKER_CONFIG:"/home/other/.docker"},{BUILDX_CONFIG:"/home/other/.docker/buildx"},{DOCKER_CONTEXT:"other"}]){const f=collectorDouble();const result=collectHostSnapshot({...f.options,environment});assert.equal(result.isolated,false);assert.equal(f.calls.some(call=>call.command==="/usr/bin/docker"),false);}
 const f=collectorDouble(),stat=f.options.stat;assert.equal(collectHostSnapshot({...f.options,stat:file=>{const value=stat(file);return file.endsWith("docker.sock")?{...value,uid:2002}:value;}}).isolated,false);
});

test("isolation reports the first condition and safe metadata without echoing private input",()=>{
 const secret="fictional-private-probe-value",cases=[
  [f=>({...f.options,environment:{DOCKER_HOST:`tcp://${secret}:2375`}}),"environment","ENVIRONMENT_CONFLICT",{key:"DOCKER_HOST"}],
  [f=>({...f.options,environment:{XDG_RUNTIME_DIR:`/${secret}`}}),"environment","ENVIRONMENT_CONFLICT",{key:"XDG_RUNTIME_DIR"}],
  [f=>({...f.options,environment:{DBUS_SESSION_BUS_ADDRESS:secret}}),"environment","ENVIRONMENT_CONFLICT",{key:"DBUS_SESSION_BUS_ADDRESS"}],
  [f=>({...f.options,stat:file=>{if(file.endsWith("docker.sock"))throw Object.assign(new Error(secret),{code:"EACCES"});return f.options.stat(file);}}),"socket","SOCKET_UNREADABLE",{errno:"EACCES"}],
  [f=>({...f.options,stat:file=>{const meta=f.options.stat(file);return file.endsWith("docker.sock")?{...meta,uid:2002}:meta;}}),"socket","SOCKET_OWNER_MISMATCH",{ownerMatches:false}],
  [f=>({...f.options,stat:file=>{const meta=f.options.stat(file);return file===HOST_PATHS.buildxConfig?{...meta,mode:0o40750}:meta;}}),"directory","DIRECTORY_NOT_PRIVATE",{role:"buildx-config",mode:"0750",ownerMatches:true}],
  [f=>({...f.options,realpath:file=>file===HOST_PATHS.dockerRoot?`/${secret}`:file}),"directory","DIRECTORY_NOT_CANONICAL",{role:"docker-data"}],
  [f=>({...f.options,run:(cmd,args,env)=>cmd==="/usr/bin/docker"?{status:1,stdout:secret,stderr:secret}:f.options.run(cmd,args,env)}),"daemon","DOCKER_INFO_COMMAND_FAILED",{exitCode:1}],
  [f=>({...f.options,run:(cmd,args,env)=>cmd==="/usr/bin/docker"?{status:null,error:Object.assign(new Error(secret),{code:"ETIMEDOUT"}),stderr:secret}:f.options.run(cmd,args,env)}),"daemon","DOCKER_INFO_COMMAND_FAILED",{errno:"ETIMEDOUT"}],
  [f=>({...f.options,run:(cmd,args,env)=>cmd==="/usr/bin/docker"?{status:0,stdout:secret}:f.options.run(cmd,args,env)}),"daemon","DOCKER_INFO_JSON_INVALID",{}],
 ];
 for(const [options,stage,code,details] of cases){
  const f=collectorDouble(),snapshot=collectHostSnapshot(options(f)),report=evaluateHostSnapshot(snapshot,target);
  assert.equal(snapshot.isolated,false);assert.equal(snapshot.isolation.stage,stage);assert.equal(snapshot.isolation.code,code);
  for(const [key,value] of Object.entries(details))assert.equal(snapshot.isolation[key],value);
  assert.equal(report.ready,false);assert.equal(JSON.stringify(report).includes(secret),false);
  assert.deepEqual(hostUpgradePlan(report).requiredActions.find(row=>row.component==="docker.isolation").cause,snapshot.isolation);
  for(const name of ["docker.service","buildkit","buildkit.daemon","docker.capabilities"]){const row=report.diagnostics.find(row=>row.component===name);assert.equal(row.status,"DEPENDENCY_BLOCKED");assert.equal(row.dependsOn,"docker.isolation");}
 }
});

test("daemon rootless/data-root/cgroup failures stay distinct and fail closed",()=>{
 for(const [patch,code] of [[{DockerRootDir:"/fictional/foreign"},"DAEMON_DATA_ROOT_MISMATCH"],[{CgroupDriver:"cgroupfs"},"CGROUP_DRIVER_MISMATCH"],[{CgroupVersion:"1"},"CGROUP_V2_REQUIRED"],[{SecurityOptions:[]},"ROOTLESS_REQUIRED"]]){
  const f=collectorDouble(),run=f.options.run;
  const snapshot=collectHostSnapshot({...f.options,run:(cmd,args,env)=>{const result=run(cmd,args,env);return cmd==="/usr/bin/docker"&&args[0]==="info"?{...result,stdout:JSON.stringify({...JSON.parse(result.stdout),...patch})}:result;}});
  assert.equal(snapshot.isolation.code,code);assert.equal(snapshot.isolated,false);assert.equal(f.calls.filter(call=>call.command==="/usr/bin/docker").length,1);
 }
});

test("daemon-managed data-root traversal is accepted without weakening private client config or ownership",()=>{
 for(const [role,modes,ok] of [[HOST_PATHS.dockerRoot,[0o700,0o710,0o711],true],[HOST_PATHS.dockerRoot,[0o750,0o755,0o770,0o777,0o1711],false],[HOST_PATHS.dockerConfig,[0o710,0o711,0o750],false],[HOST_PATHS.buildxConfig,[0o710,0o711,0o750],false]]){
  for(const mode of modes){const f=collectorDouble(),stat=f.options.stat;
   const snapshot=collectHostSnapshot({...f.options,stat:file=>{const meta=stat(file);return file===role?{...meta,mode:0o40000|mode}:meta;}});
   assert.equal(snapshot.isolated,ok,`${role}: ${mode.toString(8)}`);if(!ok)assert.equal(snapshot.isolation.code,role===HOST_PATHS.dockerRoot?"DATA_ROOT_MODE_INVALID":"DIRECTORY_NOT_PRIVATE");
  }
 }
 for(const patch of [{uid:2002},{isSymbolicLink:()=>true}]){const f=collectorDouble(),stat=f.options.stat;const snapshot=collectHostSnapshot({...f.options,stat:file=>file===HOST_PATHS.dockerRoot?{...stat(file),mode:0o40711,...patch}:stat(file)});assert.equal(snapshot.isolated,false);assert.equal(f.calls.some(call=>call.command==="/usr/bin/docker"),false);}
});

test("Docker probes use the account home and fixed user runtime instead of inherited caller settings",()=>{
 const f=collectorDouble();const snapshot=collectHostSnapshot({...f.options,environment:{HOME:"/fictional/foreign",HTTP_PROXY:"http://proxy.example.test:8080",DOCKER_TLS_VERIFY:"1"}});
 assert.equal(snapshot.isolated,true);
 for(const call of f.calls.filter(call=>call.command==="/usr/bin/docker"||call.args.includes("--user"))){assert.equal(call.env.HOME,"/home/fictional-deploy");assert.equal(call.env.XDG_RUNTIME_DIR,"/run/user/1001");assert.equal(call.env.DBUS_SESSION_BUS_ADDRESS,"unix:path=/run/user/1001/bus");assert.equal(call.env.HTTP_PROXY,undefined);assert.equal(call.env.DOCKER_TLS_VERIFY,undefined);}
});

test("runner and host probes share fixed user session settings and reject invalid account identities",()=>{
 assert.deepEqual(rootlessUserEnvironment(1001,"/home/fictional-deploy"),{HOME:"/home/fictional-deploy",XDG_RUNTIME_DIR:"/run/user/1001",DBUS_SESSION_BUS_ADDRESS:"unix:path=/run/user/1001/bus"});
 for(const uid of [0,-1,NaN,1.5,"1001"])assert.throws(()=>rootlessUserEnvironment(uid,"/home/fictional-deploy"));
 for(const home of ["relative",null,"/fictional\0home"])assert.throws(()=>rootlessUserEnvironment(1001,home));
 const runner=readFileSync(new URL("../scripts/deploy-production-runner.mjs",import.meta.url),"utf8");assert.match(runner,/\.\.\.process\.env, \.\.\.overrides, \.\.\.rootlessUserEnvironment\(\)/);
});

test("missing or untrusted deployment configuration has its own cause before any Docker command",()=>{
 const f=collectorDouble();f.values.delete("/etc/lumina-crm/deploy.env");
 const snapshot=collectHostSnapshot(f.options);assert.deepEqual(snapshot.isolation,{stage:"configuration",code:"DEPLOY_CONFIGURATION_UNREADABLE",errno:"ENOENT"});
 assert.equal(f.calls.some(call=>call.command==="/usr/bin/docker"),false);
 assert.equal(evaluateHostSnapshot(snapshot,target).diagnostics.find(row=>row.component==="host.configuration").blocking,true);
 const admission=collectHostSnapshot({...f.options,scope:"admission"});assert.deepEqual(evaluateHostSnapshot(admission,target,{scope:"admission"}).diagnostics.find(row=>row.component==="host.configuration").cause,snapshot.isolation);
});

test("deployment scope does not require unused maintenance code, units or cache flags",()=>{
 const f=collectorDouble();f.values.set(HOST_PATHS.program,"unknown maintenance bytes");f.values.delete("/etc/systemd/system/lumina-crm-storage-cleanup.service");
 const run=f.options.run,options={...f.options,run:(cmd,args,env)=>args.includes("--help")&&["prune","inspect"].includes(args[1])?{status:0,stdout:"fictional inspect help without bootstrap"}:run(cmd,args,env)};
 const snapshot=collectHostSnapshot({...options,scope:"deployment"}),report=evaluateHostSnapshot(snapshot,target,{scope:"deployment"});
 assert.equal(report.ready,true);assert.equal(report.diagnostics.some(row=>row.component==="maintenance.bundle"),false);
 assert.equal(f.calls.some(call=>call.command==="/usr/bin/systemctl"&&call.args.some(arg=>arg.includes("cleanup"))),false);
 assert.equal(f.calls.some(call=>call.args.includes("prune")),false);
 assert.equal(evaluateHostSnapshot(collectHostSnapshot(options),target).ready,false);
 const broken=collectorDouble();broken.values.set("/etc/systemd/system/lumina-crm-deploy.service","unreviewed deployment bytes");
 assert.equal(evaluateHostSnapshot(collectHostSnapshot({...broken.options,scope:"deployment"}),target,{scope:"deployment"}).diagnostics.find(row=>row.component==="systemd.units").blocking,true);
});

test("admission avoids Docker probes but preserves unit, lock, operation and disk gates",()=>{
 const f=collectorDouble(),snapshot=collectHostSnapshot({...f.options,scope:"admission"});
 assert.equal(evaluateHostSnapshot(snapshot,target,{scope:"admission"}).ready,true);assert.equal(f.calls.some(call=>call.command==="/usr/bin/docker"),false);
 for(const [key,value] of [["unitsReady",false],["configurationReady",false],["deployLockFree",false],["maintenanceLockFree",false],["admissionLockReady",false],["operationPending",true],["diskReady",false]])assert.equal(evaluateHostSnapshot({...snapshot,[key]:value},target,{scope:"admission"}).ready,false,key);
 assert.throws(()=>collectHostSnapshot({...f.options,scope:"skip-security"}),/SCOPE_INVALID/);
});

test("public host diagnostics cannot select admission or ambiguously override target/scope",()=>{
 for(const args of [["host-check","--scope=admission"],["host-check","--scope=deployment","--scope=full"],["host-check",`--target=${commit}`,`--target=${next}`],["host-upgrade-plan","--scope=deployment"]]){
  const result=spawnSync(process.execPath,["scripts/deploy-production.mjs",...args],{encoding:"utf8",timeout:3000});assert.equal(result.status,1);assert.match(result.stderr,/HOST_CHECK_ARGUMENT_INVALID/);
 }
});

test("target static requirements are read by fixed git-show paths and never executed",async()=>{
 const calls=[];const result=await readStaticHostTarget(async(args,options)=>{calls.push({args,options});assert.equal(args[0],"show");assert.ok(args[1].startsWith(`${next}:`));const file=args[1].slice(41);return readFileSync(new URL(`../${file}`,import.meta.url),"utf8");},next);
 assert.equal(result.bundle.digest,target.bundle.digest);assert.equal(calls.every(call=>call.options.raw===true),true);assert.equal(result.contract.revision,HOST_CONTRACT.revision);
 await assert.rejects(readStaticHostTarget(async()=>"{}",next));
});
test("fetched target rejection stops before merge, and bootstrap preflight rejection preserves existing state",async t=>{
 const calls=[],git=async args=>{calls.push(args);if(args[0]==="branch")return"main";if(args[0]==="remote")return"git@github.com:kewtgh/crm.git";if(args[0]==="status")return"";if(args[0]==="rev-parse")return args[1]==="HEAD"?commit:next;return"";};
 const rejection=Object.assign(new Error("HOST_PREFLIGHT_FAILED"),{code:"HOST_PREFLIGHT_FAILED",diagnostics:{ready:false}});
 await assert.rejects(updateSourceAndResolveTarget({git,verifyTarget:async()=>{throw rejection;}}),/HOST_PREFLIGHT_FAILED/);assert.equal(calls.some(args=>args[0]==="merge"),false);assert.equal(calls.some(args=>args[0]==="fetch"),true);
 const directory=await mkdtemp(path.join(os.tmpdir(),"crm-host-gate-"));t.after(()=>rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:25}));const requestPath=path.join(directory,"request.json"),latestPath=path.join(directory,"latest.json");await writeFile(requestPath,JSON.stringify({requestId:uuid(1),mode:"deploy",sourceRoot:directory}));await writeFile(latestPath,'{"historical":"unchanged"}');
 await assert.rejects(runBootstrap({requestPath,sourceRoot:directory,updateSource:async()=>{throw rejection;},spawnController:async()=>assert.fail("must not spawn")}),/HOST_PREFLIGHT_FAILED/);assert.equal(await readFile(latestPath,"utf8"),'{"historical":"unchanged"}');
});
test("Bootstrap inherits its current Node executable for target handoff",async()=>{
 let executable;await spawnTargetController({runnerPath:"fixture-runner",targetCommit:next,bootstrapCommit:commit,spawnProcess:(command)=>{executable=command;const child=new EventEmitter();child.pid=process.pid+1;queueMicrotask(()=>{child.emit("spawn");child.emit("exit",0,null);});return child;}});assert.equal(executable,process.execPath);
});

test("a preflight-admitted request keeps its fetched SHA without a second fetch or target drift",async()=>{
 let merged=false;const calls=[];
 const git=async args=>{calls.push(args);if(args[0]==="branch")return"main";if(args[0]==="remote")return"git@github.com:kewtgh/crm.git";if(args[0]==="status")return"";if(args[0]==="cat-file")return"commit";if(args[0]==="rev-parse")return args[1]==="HEAD"?(merged?next:commit):"c".repeat(40);if(args[0]==="merge")merged=true;return"";};
 const result=await updateSourceAndResolveTarget({git,requestedTarget:next,verifyTarget:async sha=>{assert.equal(sha,next);assert.equal(merged,false);assert.equal(evaluateHostSnapshot(ready(),target).ready,true);}});
 assert.equal(result.targetCommit,next);assert.equal(calls.some(args=>args[0]==="fetch"),false);assert.equal(calls.some(args=>args[0]==="merge-base"&&args[2]===next),true);assert.equal(merged,true);
});

function upgradeDouble(failAt=null){
 let observed=builder("moby/buildkit:v0.33.1"),active=null,busy=false,removed=0,created=0,failed=false;
 const plan=builderReplacementPlan(observed),operations={
  exclusive:async fn=>{if(busy)throw new Error("HOST_OPERATION_BUSY");busy=true;try{return await fn();}finally{busy=false;}},
  readActive:async()=>clone(active),snapshot:async()=>clone(observed),
  persist:async journal=>{if(failAt===journal.stage&&!failed){failed=true;throw new Error("INJECTED_PERSISTENCE_FAILURE");}active=clone(journal);},
  removeOwned:async()=>{removed++;observed.inspect=null;if(failAt==="REMOVE_COMMAND"&&!failed){failed=true;throw new Error("INJECTED_REMOVE_FAILURE");}},
  createOwned:async nonce=>{created++;observed={...builder(HOST_CONTRACT.builder.image,nonce),marker:observed.marker};},
  verifyReplacement:async()=>{if(failAt==="VERIFY"&&!failed){failed=true;throw new Error("INJECTED_VERIFY_FAILURE");}},
  targetMarker:journal=>({...builder().marker,hostOperationId:journal.operationId}),
  writeMarker:async marker=>{observed.marker=clone(marker);},finish:async()=>{},
 };return{plan,operations,get active(){return active;},get removed(){return removed;},get created(){return created;},set observed(value){observed=value;}};
}
test("builder upgrades require exact approval and explicit cache-loss acknowledgement before operations",async()=>{
 const f=upgradeDouble();for(const patch of [{approval:null,acknowledgeCacheLoss:true},{approval:f.plan.approvalSha256,acknowledgeCacheLoss:false}])await assert.rejects(replaceOwnedBuilder({plan:f.plan,operations:f.operations,...patch}),/APPROVAL_REQUIRED/);assert.equal(f.removed,0);assert.equal(f.active,null);
});
test("owned builder replacement succeeds, records stages, and never repeats removal on completed resume",async()=>{
 const f=upgradeDouble(),input={plan:f.plan,approval:f.plan.approvalSha256,acknowledgeCacheLoss:true,operations:f.operations};const result=await replaceOwnedBuilder(input);assert.equal(result.stage,"COMPLETE");assert.equal(result.events.length,7);await replaceOwnedBuilder({...input,resumeId:result.operationId});assert.equal(f.removed,1);assert.equal(f.created,1);
});
test("builder crash recovery verifies the replacement nonce instead of deleting the new builder",async()=>{
 for(const stage of ["REMOVED","CREATED","MARKER_INTENT","COMPLETE","REMOVE_COMMAND","VERIFY"]){const f=upgradeDouble(stage),input={plan:f.plan,approval:f.plan.approvalSha256,acknowledgeCacheLoss:true,operations:f.operations};await assert.rejects(replaceOwnedBuilder(input),/INJECTED/);const result=await replaceOwnedBuilder({...input,resumeId:f.active.operationId});assert.equal(result.stage,"COMPLETE",stage);assert.equal(f.removed,1,stage);assert.equal(f.created,1,stage);}
});
test("an unexpected builder after a create interruption remains untouched",async()=>{
 const f=upgradeDouble("CREATED"),input={plan:f.plan,approval:f.plan.approvalSha256,acknowledgeCacheLoss:true,operations:f.operations};await assert.rejects(replaceOwnedBuilder(input));f.observed=builder(HOST_CONTRACT.builder.image,uuid(999));await assert.rejects(replaceOwnedBuilder({...input,resumeId:f.active.operationId}));assert.equal(f.removed,1);
});
test("host operations exclude concurrent replacements",async()=>{
 const f=upgradeDouble(),input={plan:f.plan,approval:f.plan.approvalSha256,acknowledgeCacheLoss:true,operations:f.operations};const results=await Promise.allSettled([replaceOwnedBuilder(input),replaceOwnedBuilder(input)]);assert.equal(results.filter(value=>value.status==="fulfilled").length,1);assert.equal(f.removed,1);
});
test("host lock order and actual kernel ownership are required; environment flags are insufficient",()=>{
 assert.throws(()=>hostLockArguments([HOST_PATHS.maintenanceLock,HOST_PATHS.deployLock],"node","entry",[]),/HOST_LOCK_ORDER/);
 assert.throws(()=>hostLockArguments(["/var/run/docker.sock"],"node","entry",[]));
 const files=[HOST_PATHS.deployLock,HOST_PATHS.maintenanceLock],read=file=>file==="/proc/locks"?"1: FLOCK ADVISORY WRITE 41 00:01:2 0 EOF\n":file==="/proc/42/stat"?"42 (node) S 41 0":"41 (flock) S 1 0";
 const options={platform:"linux",pid:42,read,stat:()=>({dev:1,ino:2,mode:0o640,isFile:()=>true,isSymbolicLink:()=>false}),realpath:file=>file};assert.equal(hostLocksHeld(files,options),true);assert.equal(hostLocksHeld(files,{...options,read:file=>file==="/proc/locks"?"1: FLOCK ADVISORY WRITE 99 00:01:2 0 EOF\n":read(file)}),false);
});

test("maintenance installer approval binds all assets and recovers after atomic activation",async()=>{
 let launcher="previous reviewed program",journal=null,locked=false,activations=0,fail=true;const plan=maintenanceInstallPlan(assets,launcher),operations={exclusive:async fn=>{if(locked)throw new Error("BUSY");locked=true;try{return await fn();}finally{locked=false;}},readJournal:async()=>clone(journal),readLauncher:async()=>launcher,persist:async value=>{if(value.stage==="COMPLETE"&&fail){fail=false;throw new Error("AFTER_ACTIVATION_FAILURE");}journal=clone(value);},stageBundle:async bundle=>assert.equal(bundle.digest,target.bundle.digest),preservePrevious:async(_j,text)=>assert.equal(text,"previous reviewed program"),activate:async text=>{activations++;launcher=text;},writeReceipt:async receipt=>assert.equal(receipt.stage,"COMPLETE")};
 await assert.rejects(installMaintenance({assets,plan,approval:"wrong",operations}),/APPROVAL/);assert.equal(activations,0);
 await assert.rejects(installMaintenance({assets:{...assets,[HOST_CONTRACT_PATH]:assets[HOST_CONTRACT_PATH]+" "},plan,approval:plan.approvalSha256,operations}),/APPROVAL/);
 await assert.rejects(installMaintenance({assets,plan,approval:plan.approvalSha256,operations}),/AFTER_ACTIVATION/);const result=await installMaintenance({assets,plan,approval:plan.approvalSha256,resumeId:journal.operationId,operations});assert.equal(result.stage,"COMPLETE");assert.equal(activations,1);
});

const environment={LUMINA_BOOTSTRAP_ATTEMPT_ID:uuid(3),LUMINA_HOST_HANDOFF_NONCE:uuid(4),LUMINA_TARGET_SOURCE_COMMIT:next};
const request={requestId:uuid(1),launchId:uuid(2),mode:"deploy",sourceRoot:HOST_PATHS.source};
test("controller writes a bound rejection before effects and an admitted receipt before normal work",async()=>{
 let receipt=null,checked=false;await assert.rejects(runControllerEntry({request,environment,nodeVersion:"v24.22.0",validateSource:()=>{},preflight:()=>{checked=true;},write:(_file,value)=>{receipt=value;}}),/NODE_RUNTIME_INCOMPATIBLE/);assert.equal(checked,false);assert.ok(validateEarlyRejection(receipt,controllerEntryIdentity(request,environment)));
 const order=[];await runControllerEntry({request,environment,validateSource:()=>order.push("source"),preflight:()=>order.push("preflight"),write:(_file,value)=>{receipt=value;order.push(value.outcome);}});order.push("business");assert.deepEqual(order,["source","preflight","ADMITTED","business"]);assert.throws(()=>validateEarlyRejection(receipt,controllerEntryIdentity(request,environment)));
});

test("controller rejection preserves safe first-cause diagnostics without changing the receipt protocol",async()=>{
 let receipt;const diagnostics={ready:false,diagnostics:[{component:"docker.isolation",cause:{stage:"directory",code:"DIRECTORY_NOT_PRIVATE",role:"buildx-config",mode:"0750"}}]};
 await assert.rejects(runControllerEntry({request,environment,validateSource:()=>{},preflight:()=>{throw Object.assign(new Error("HOST_PREFLIGHT_FAILED"),{code:"HOST_PREFLIGHT_FAILED",diagnostics});},write:(_file,value)=>{receipt=value;}}),error=>error.code==="HOST_PREFLIGHT_FAILED"&&error.diagnostics===diagnostics&&/^[0-9a-f]{64}$/.test(error.entryReceiptSha256));
 assert.ok(validateEarlyRejection(receipt,controllerEntryIdentity(request,environment)));assert.equal(receipt.businessEffects,"NOT_STARTED");assert.equal(receipt.diagnostics,undefined);
});

async function rejectionFixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),"crm-entry-"));t.after(()=>rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:25}));await mkdir(path.join(root,"scripts"));await mkdir(path.join(root,"state"));await writeFile(path.join(root,"package.json"),'{"version":"3.40.0"}');await writeFile(path.join(root,"scripts/deploy-production-runner.mjs"),"// fictional target\n");const req={...request,sourceRoot:root,targetCommit:next},requestPath=path.join(root,"state/request.json"),latestPath=path.join(root,"state/latest.json");await writeFile(requestPath,JSON.stringify(req));
 const code=await runBootstrap({requestPath,sourceRoot:root,updateSource:async()=>({bootstrapCommit:commit,targetCommit:next}),spawnController:async options=>{try{await runControllerEntry({request:req,stateRoot:path.dirname(requestPath),environment:{...options.environment,LUMINA_TARGET_SOURCE_COMMIT:next},nodeVersion:"v24.22.0",validateSource:()=>{},preflight:()=>assert.fail("old runtime must stop first")});}catch(error){assert.equal(error.code,"NODE_RUNTIME_INCOMPATIBLE");return{code:1,pid:process.pid};}assert.fail("must reject");}});assert.equal(code,1);
 const latest=JSON.parse(await readFile(latestPath,"utf8")),bootstrap=JSON.parse(await readFile(path.join(root,"state",`bootstrap-${req.requestId}-${latest.attempts.at(-1).attemptId}.json`),"utf8")),receipt=JSON.parse(await readFile(path.join(root,"state",latest.earlyRejection.file),"utf8"));return{root,requestPath,latestPath,evidence:{request:req,latest,bootstrap,receipt,records:[]}};
}
test("started-but-rejected requests can be explicitly archived with immutable evidence and resumed archival",async t=>{
 const f=await rejectionFixture(t),plan=earlyArchivePlan(f.evidence),archive=path.join(f.root,"state/request-archived.json");let ledger=null,renames=0,fail=true;const before=await readFile(f.latestPath,"utf8"),operations={exclusive:async fn=>fn(),evidence:async()=>clone(f.evidence),readLedger:async()=>clone(ledger),persist:async value=>{if(value.stage==="ARCHIVED"&&fail){fail=false;throw new Error("ARCHIVE_FINALIZATION_FAILURE");}ledger=clone(value);},renameOnce:async()=>{if(!renames){await rename(f.requestPath,archive);renames++;}}};
 await assert.rejects(archiveEarlyRequest({plan,approval:"wrong",operations}),/APPROVAL/);await assert.rejects(archiveEarlyRequest({plan,approval:plan.approvalSha256,operations}),/FINALIZATION_FAILURE/);await archiveEarlyRequest({plan,approval:plan.approvalSha256,operations});assert.equal(renames,1);assert.equal(await readFile(f.latestPath,"utf8"),before);assert.equal(JSON.parse(await readFile(archive,"utf8")).requestId,request.requestId);
});
test("missing/corrupt rejection, earlier effects, admitted entry and finalization failures remain fail closed",async t=>{
 const {evidence}=await rejectionFixture(t);assert.ok(earlyArchivePlan(evidence));
 for(const patch of [{receipt:null},{receipt:{...evidence.receipt,nonce:uuid(9)}},{latest:{...evidence.latest,migrationMayHaveChanged:true}},{bootstrap:{...evidence.bootstrap,workerSwitch:"SWITCH_STARTED"}},{records:[{requestId:request.requestId,outcome:"ADMITTED"}]},{records:[{requestId:request.requestId,result:"CONTROL_PLANE_FINALIZATION_FAILED"}]},{records:[{requestId:request.requestId,controllerStarted:true,result:"BOOTSTRAP_FAILED",attempts:[{attemptId:uuid(9)}]}]},{serviceActive:true}])assert.throws(()=>earlyArchivePlan({...clone(evidence),...patch}));
});

test("incomplete early archival blocks a fresh deployment until reconciled",()=>{for(const ledger of [null,{schemaVersion:1,stage:"ARCHIVED",archiveVerified:false},{schemaVersion:1,stage:"ARCHIVE_INTENT"},{schemaVersion:1,stage:"APPROVED"}])assert.throws(()=>assertNoIncompleteEarlyArchive([ledger]),/FINALIZATION_REQUIRED/);assert.doesNotThrow(()=>assertNoIncompleteEarlyArchive([{schemaVersion:1,stage:"ARCHIVED",archiveVerified:true}]));});

test("controller-not-started archival still requires independent original bootstrap proof",async t=>{const {evidence}=await rejectionFixture(t);const latest={...evidence.latest,result:"BOOTSTRAP_FAILED",controllerStarted:false,recoverySafe:true,attempts:evidence.latest.attempts.map(value=>({...value,controllerStarted:false}))};assert.throws(()=>earlyArchivePlan({...evidence,latest,receipt:null}));const safe={...evidence,latest,bootstrap:clone(latest),receipt:null};assert.ok(earlyArchivePlan(safe));});
