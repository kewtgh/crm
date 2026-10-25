import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync,mkdirSync,copyFileSync,chmodSync,rmSync,readFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {prepareComposeCapabilityRuntime} from "../scripts/prepare-compose-capability-runtime.mjs";
import {CAPABILITY_COMPOSE_MODEL,COMPOSE_SECURITY_ARGUMENTS,probeComposeSecurityModel,probeHostCapabilities,validateComposeCapabilities} from "../scripts/lib/host-capabilities.mjs";
import {normalizeHostVersion,HOST_CONTRACT} from "../deploy/libexec/lumina-host-contract.mjs";
import {evaluateHostSnapshot,localHostTarget} from "../scripts/lib/host-preflight.mjs";
import {sourceAdoptionPlan} from "../scripts/deploy-legacy-transition.mjs";

function composeProcess(t,binary){
 const directory=mkdtempSync(path.join(os.tmpdir(),"crm-compose-capability-"));t.after(()=>rmSync(directory,{recursive:true,force:true,maxRetries:3,retryDelay:50}));
 const config=path.join(directory,"docker-config"),plugin=path.join(config,"cli-plugins",process.platform==="win32"?"docker-compose.exe":"docker-compose");mkdirSync(path.dirname(plugin),{recursive:true,mode:0o700});copyFileSync(binary,plugin);if(process.platform!=="win32")chmodSync(plugin,0o700);
 if(process.env.LUMINA_V1_UBUNTU_PROFILE==="1"){assert.equal(process.platform,"linux");const buildx=path.join(config,"cli-plugins","docker-buildx");assert.ok(process.env.LUMINA_UBUNTU_BUILDX_PATH);copyFileSync(process.env.LUMINA_UBUNTU_BUILDX_PATH,buildx);chmodSync(buildx,0o700);}
 const environment={...process.env,DOCKER_CONFIG:config,BUILDX_CONFIG:path.join(config,"buildx"),DOCKER_HOST:process.platform==="win32"?"npipe:////./pipe/lumina-compose-capability-no-daemon":`unix://${directory}/unreachable-docker.sock`,COMPOSE_DISABLE_ENV_FILE:"true"};
 for(const key of ["DOCKER_CONTEXT","DOCKER_TLS_VERIFY","DOCKER_CERT_PATH","DOCKER_API_VERSION","COMPOSE_FILE","COMPOSE_ENV_FILES","COMPOSE_PROFILES","COMPOSE_COMPATIBILITY"])delete environment[key];
 const run=(command,args,env=environment,input)=>{assert.equal(command,"/usr/bin/docker");return spawnSync(process.platform==="win32"?"docker.exe":"docker",args,{cwd:directory,env,input,encoding:"utf8",timeout:15000,maxBuffer:2_000_000,windowsHide:true});};
 const version=run("/usr/bin/docker",["compose","version","--short"]);assert.equal(version.status,0,"Pinned Compose plugin must execute");assert.equal(normalizeHostVersion("compose",version.stdout.trim()),"2.40.3","This test requires the actual 2.40.3 CLI, including Ubuntu distribution suffixes");
 if(process.platform==="linux"&&process.env.CI==="true")assert.match(readFileSync("/etc/os-release","utf8"),/^ID=ubuntu$/m,"Linux CI integration must execute on Ubuntu");
 console.log(`Compose capability integration: ${JSON.stringify({version:version.stdout.trim(),platform:process.platform,sha256:createHash("sha256").update(readFileSync(binary)).digest("hex"),daemonAccess:false})}`);
 if(process.env.LUMINA_V1_UBUNTU_PROFILE==="1"){
  assert.match(readFileSync("/etc/os-release","utf8"),/^VERSION_ID="26\.04"$/m);
  const docker=run("/usr/bin/docker",["--version"]),buildx=run("/usr/bin/docker",["buildx","version"]);assert.equal(docker.status,0);assert.equal(buildx.status,0);assert.match(docker.stdout,/\b29\.1\.3\b/);assert.match(buildx.stdout,/\bv?0\.30\.1\b/);
  assert.equal(probeHostCapabilities(run,environment,{scope:"deployment"}).ready,true,"Actual Ubuntu clients must support every deployment capability and security field");
  console.log("Ubuntu 26.04 / Docker client 29.1.3 / Compose 2.40.3 / Buildx 0.30.1: VERIFIED; daemon access NOT_RUN");
 }
 return{run,environment};
}
function readyHost(capability){
 // All non-Compose host observations are explicit fixtures, not a claim about this machine.
 const image=HOST_CONTRACT.builder.image,endpoint="unix:///run/user/1001/docker.sock",fingerprint="f".repeat(64);
 return{versions:{node:"24.22.1",npm:"12.2.1",docker:"29.1.3",compose:"2.40.3+ds1-0ubuntu1",buildx:"0.30.1-0ubuntu1"},systemdNode:"24.22.1",sameNode:true,identity:true,isolated:true,dockerServiceReady:true,builder:{image,endpoint,fingerprint,proxy:"",marker:{owner:"kewtgh/crm",builder:"lumina-crm-buildkit",driver:"docker-container",builderNetworkMode:"host",configSha256:fingerprint,dockerProxyEnabled:false,dockerProxySha256:null},inspect:`Name: lumina-crm-buildkit\nDriver: docker-container\nEndpoint: ${endpoint}\nDriver Options: network="host" image="${image}"\n`},builderDaemon:{image,network:"host"},maintenanceTrust:{protocol:0,trust:"LEGACY_SUPPORTED",builderImages:[image],capabilities:["trusted-code"]},capabilities:{profile:"crm-compose-buildx-v1",ready:capability.status==="VERIFIED",results:[capability]},unitsReady:true,admissionLockReady:true,deployLockFree:true,maintenanceLockFree:true,operationPending:false,diskReady:true,disk:[]};
}
test("real Compose 2.40.3 parses the production probe YAML and preserves every security field",async t=>{
 const {run,environment}=composeProcess(t,await prepareComposeCapabilityRuntime());
 const result=run("/usr/bin/docker",[...COMPOSE_SECURITY_ARGUMENTS],environment,CAPABILITY_COMPOSE_MODEL);assert.equal(result.status,0,"Actual production YAML must parse");
 const model=JSON.parse(result.stdout),web=model.services.web;assert.equal(validateComposeCapabilities(model),true);
 assert.deepEqual({user:web.user,init:web.init,read_only:web.read_only,cap_drop:web.cap_drop,security_opt:web.security_opt,pids_limit:web.pids_limit,cpus:Number(web.cpus),tmpfs:web.tmpfs,networks:web.networks},{user:"10001:10001",init:true,read_only:true,cap_drop:["ALL"],security_opt:["no-new-privileges:true"],pids_limit:256,cpus:1,tmpfs:["/tmp:rw,noexec,nosuid,nodev"],networks:{backend:null}});
 assert.ok(web.mem_limit==="512m"||web.mem_limit===536870912,"The real config must retain exactly 512 MiB, whether human-readable or byte-normalized");
 assert.equal(model.networks.backend.internal,true);assert.equal(web.ports.length,1);assert.equal(web.ports[0].host_ip,"127.0.0.1");assert.equal(web.ports[0].target,3200);assert.equal(String(web.ports[0].published),"3200");assert.equal(web.ports[0].protocol,"tcp");
 const capability=probeComposeSecurityModel(run,environment);assert.equal(capability.status,"VERIFIED",JSON.stringify(capability));
 const snapshot=readyHost(capability),report=evaluateHostSnapshot(snapshot,localHostTarget());assert.equal(report.ready,true,JSON.stringify(report));assert.equal(report.diagnostics.find(row=>row.component==="docker.capabilities").status,"READY");
 const repository=fileURLToPath(new URL("..",import.meta.url)),target="b".repeat(40),runGit=(command,args)=>{assert.equal(command,"git");if(args[0]==="show")return readFileSync(path.join(repository,args[1].slice(41)),"utf8");if(args[0]==="rev-parse")return"796cc43e63784eb8891ca6420572cd563cb2ac80";if(args[0]==="branch")return"main";if(args[0]==="remote")return"https://github.com/kewtgh/crm.git";assert.notEqual(args[0],"merge","adopt plan must not fast-forward");return"";};
 const plan=await sourceAdoptionPlan({target,toolSha256:"c".repeat(64),run:runGit,preflight:options=>assert.equal(evaluateHostSnapshot(snapshot,options.target).ready,true)});assert.equal(plan.target,target);
 for(const patch of [{isolated:false},{unitsReady:false},{maintenanceLockFree:false},{diskReady:false}])assert.equal(evaluateHostSnapshot({...snapshot,...patch},localHostTarget()).ready,false,"Compose success must not bypass other host gates");
 const broken=CAPABILITY_COMPOSE_MODEL.replace('tmpfs: ["/tmp:rw,noexec,nosuid,nodev"]',"tmpfs: [/tmp:rw,noexec,nosuid,nodev]");
 const parsed=run("/usr/bin/docker",[...COMPOSE_SECURITY_ARGUMENTS],environment,broken);assert.equal(parsed.status,0);assert.equal(JSON.parse(parsed.stdout).services.web.tmpfs.length,4,"Real Compose must reproduce the original flow-array defect");
 const rejected=probeComposeSecurityModel((command,args,env)=>run(command,args,env,broken),environment);assert.equal(rejected.status,"SECURITY_MISMATCH");for(const option of ["noexec","nosuid","nodev"])assert.ok(rejected.diagnostics.some(row=>row.field===`services.web.tmpfs.${option}`));
 const invalid=probeComposeSecurityModel((command,args,env)=>run(command,args,env,"services: [\n"),environment);assert.equal(invalid.status,"YAML_INVALID");
});
