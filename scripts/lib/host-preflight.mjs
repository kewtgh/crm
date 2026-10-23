import {spawnSync} from "node:child_process";
import {readFileSync,lstatSync,realpathSync,statfsSync,existsSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {probeHostCapabilities} from "./host-capabilities.mjs";
import {inspectMaintenanceTrust,trustedUnit} from "./host-trust.mjs";
import {parseDockerBuildProxy} from "./docker-build-proxy.mjs";
import {HOST_CONTRACT,HOST_CONTRACT_PATH,HOST_PATHS,MAINTENANCE_ASSETS,validateHostContract,componentDiagnostic,maintenanceBundle,sha256,validateOwnedBuilder,supportedBuilderImage} from "../../deploy/libexec/lumina-host-contract.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
export const HOST_UNIT_PATHS=["lumina-crm.service","lumina-crm-deploy.service","lumina-crm-storage-prepare.service","lumina-crm-build-cache-cleanup.service","lumina-crm-storage-cleanup.service"];
export function localHostTarget(sourceRoot=root){const assets=Object.fromEntries(MAINTENANCE_ASSETS.map(file=>[file,readFileSync(path.join(sourceRoot,file),"utf8")]));return validateStaticHostTarget(assets,readFileSync(path.join(sourceRoot,"package.json"),"utf8"),readFileSync(path.join(sourceRoot,".nvmrc"),"utf8"));}
export function validateStaticHostTarget(assets,packageText,nodePin){
 const contract=validateHostContract(JSON.parse(assets[HOST_CONTRACT_PATH])),manifest=JSON.parse(packageText);
 if(manifest.engines?.node!==contract.components.node.required||manifest.engines?.npm!==contract.components.npm.required||manifest.packageManager!==`npm@${contract.components.npm.recommended}`||nodePin.trim()!==contract.components.node.recommended)throw new Error("HOST_CONTRACT_MANIFEST_MISMATCH");
 return{contract,bundle:maintenanceBundle(assets)};
}
export async function readStaticHostTarget(git,commit){
 if(!/^[0-9a-f]{40}$/.test(commit))throw new Error("HOST_TARGET_INVALID");
 const read=async file=>{const text=await git(["show",`${commit}:${file}`],{raw:true});if(typeof text!=="string"||Buffer.byteLength(text)>2_000_000)throw new Error("HOST_TARGET_ASSET_INVALID");return text;};
 const assets={};for(const file of MAINTENANCE_ASSETS)assets[file]=await read(file);
 const units={};for(const unit of HOST_UNIT_PATHS)units[unit]=await read(`deploy/systemd/${unit}`);
 return{...validateStaticHostTarget(assets,await read("package.json"),await read(".nvmrc")),commit,units};
}
const item=(component,current,required,ok,remediation)=>({component,current,required,status:ok?"READY":"BLOCKED",blocking:!ok,remediation:ok?null:remediation});
export function evaluateHostSnapshot(snapshot,target,{executionLockHeld=false}={}){
 const {contract}=target,rows=[];
 for(const name of Object.keys(contract.components)){const row=componentDiagnostic(name,snapshot.versions?.[name],contract.components[name]);if(!snapshot.isolated&&["docker","compose","buildx"].includes(name)&&row.current===null){row.status="DEPENDENCY_BLOCKED";row.dependsOn="docker.isolation";}rows.push(row);}
 rows.push(componentDiagnostic("systemd.node",snapshot.systemdNode,contract.components.node));
 rows.push(item("systemd.node.identity",snapshot.sameNode??false,"CLI, systemd, Bootstrap and target use the same Node executable",snapshot.sameNode===true,"Install the approved Node toolchain at /usr/bin/node and rerun diagnostics with that executable"));
 rows.push(item("host.identity",snapshot.identity??null,"non-root lumina-crm on Linux",snapshot.identity===true,"Run as the lumina-crm host account on Linux"));
 rows.push(item("docker.isolation",snapshot.isolated??false,"CRM-owned socket, data root and private Docker/Buildx config",snapshot.isolated===true,"Review CRM rootless socket ownership, daemon data root, cgroup v2 and private configuration directories"));
 rows.push(item("docker.service",snapshot.dockerServiceReady??false,"active docker.service in the lumina-crm user systemd manager",snapshot.dockerServiceReady===true,"Review the CRM user manager and its rootless Docker service; do not restart another daemon"));
 let builderError=null;try{const image=snapshot.builder?.image;if(!supportedBuilderImage(image,contract))throw new Error("BUILDKIT_IMAGE_NOT_AUDITED");validateOwnedBuilder({...snapshot.builder,image});}catch(error){builderError=error.message;}
 rows.push(item("buildkit",{image: snapshot.builder?.image??null,configurationVerified:!builderError},contract.builder,builderError===null,`${builderError??""}: use host-upgrade-plan; owner-verified replacement requires explicit cache-loss approval`));
 rows.push(item("buildkit.daemon",snapshot.builderDaemon??null,{image:contract.builder.image,network:"host"},supportedBuilderImage(snapshot.builderDaemon?.image,contract)&&snapshot.builderDaemon?.image===snapshot.builder?.image&&snapshot.builderDaemon?.network==="host"&&(!snapshot.builder?.marker?.hostOperationId||snapshot.builderDaemon?.operationId===snapshot.builder.marker.hostOperationId),"Operator-approved builder bootstrap/replace is required; metadata alone cannot prove the daemon image"));
 const maintenanceReady=snapshot.maintenanceTrust&&snapshot.maintenanceTrust.builderImages?.includes(snapshot.builder?.image)&&(contract.maintenance?.supportedProtocols??[1]).includes(snapshot.maintenanceTrust.protocol)&&(contract.maintenance?.requiredCapabilities??["trusted-code"]).every(value=>snapshot.maintenanceTrust.capabilities.includes(value));
 rows.push({...item("maintenance.bundle",snapshot.maintenanceTrust??null,"trusted compatible maintenance protocol",Boolean(maintenanceReady),"Audit unknown code or install an approved compatible maintenance bundle; application-source equality is not required"),...(maintenanceReady&&snapshot.maintenanceTrust.trust==="LEGACY_SUPPORTED"?{status:"LEGACY_SUPPORTED"}:{})});
 rows.push(item("docker.capabilities",snapshot.capabilities??null,contract.capabilityProfile??"crm-compose-buildx-v1",snapshot.capabilities?.ready===true,"Inspect the reported missing flags/security-model capability using Ubuntu packages; no Docker CE migration is implied"));
 rows.push(item("systemd.units",snapshot.unitsReady??false,"reviewed CRM deployment and maintenance units",snapshot.unitsReady===true,"Install reviewed systemd units and run daemon-reload as operator"));
 rows.push(item("admission.lock",snapshot.admissionLockReady??false,"preprovisioned CRM-owned admission lock",snapshot.admissionLockReady===true,"Provision the fixed CRM lock files as operator before requesting deployment"));
 rows.push(item("deployment.lock",snapshot.deployLockFree??false,"exclusive deployment lock available",executionLockHeld||snapshot.deployLockFree===true,"Wait for the current deployment or host operation; never bypass the lock"));
 rows.push(item("maintenance.lock",snapshot.maintenanceLockFree??false,"exclusive maintenance lock available",snapshot.maintenanceLockFree===true,"Wait for CRM maintenance to finish"));
 rows.push(item("host.operation",snapshot.operationPending??true,"no incomplete CRM host upgrade",snapshot.operationPending===false,"Explicitly resume the recorded host operation before deploying"));
 rows.push(item("disk",snapshot.disk??null,"configured minimum capacity and free percentage",snapshot.diskReady===true,"Free reviewed project artifacts or increase capacity; preserve database volumes and evidence"));
 for(const row of rows){if(!snapshot.isolated&&["buildkit","buildkit.daemon","docker.capabilities","docker.service"].includes(row.component)){row.status="DEPENDENCY_BLOCKED";row.dependsOn="docker.isolation";}else if(row.status!=="DEPENDENCY_BLOCKED"&&row.blocking&&row.current===null)row.status="NOT_CHECKED";}
 return{schemaVersion:1,contractRevision:contract.revision,targetCommit:target.commit??null,ready:rows.every(row=>!row.blocking),diagnostics:rows};
}
export function collectHostSnapshot({environment=process.env,sourceRoot=root,unitSources=null,platform=process.platform,uid=process.getuid?.(),executable=process.execPath,read=readFileSync,stat=lstatSync,realpath=realpathSync,statfs=statfsSync,run=(command,args,env,input)=>spawnSync(command,args,{input,encoding:"utf8",timeout:3000,maxBuffer:2_000_000,windowsHide:true,env,stdio:[input===undefined?"ignore":"pipe","pipe","pipe"]})}={}){
 const snapshot={versions:{node:process.version},builder:{},disk:[]};
 const safe=(fn,fallback=null)=>{try{return fn();}catch{return fallback;}};
 const command=(name,args,env=environment)=>{const result=run(name,args,env);if(result.error||result.status!==0)throw new Error("HOST_READ_FAILED");return String(result.stdout??"").trim();};
 const env={PATH:"/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",LANG:"C.UTF-8",DOCKER_HOST:`unix:///run/user/${uid}/docker.sock`,DOCKER_CONFIG:HOST_PATHS.dockerConfig,BUILDX_CONFIG:HOST_PATHS.buildxConfig};
 const rootFile=file=>{const meta=stat(file);if(!meta.isFile()||meta.isSymbolicLink()||meta.uid!==0||(meta.mode&0o022)!==0||realpath(file)!==file)throw new Error("ROOT_FILE_INVALID");return read(file,"utf8");};
 snapshot.identity=safe(()=>platform==="linux"&&uid>0&&command("/usr/bin/id",["-un"])==="lumina-crm",false);
 snapshot.versions.npm=safe(()=>command("npm",["--version"]));
 snapshot.systemdNode=safe(()=>command("/usr/bin/node",["--version"]));
 snapshot.sameNode=safe(()=>realpath(executable)===realpath("/usr/bin/node"),false);
 const settings=safe(()=>{const text=rootFile("/etc/lumina-crm/deploy.env");return Object.fromEntries(text.split(/\r?\n/).filter(line=>/^[A-Z][A-Z_0-9]*=/.test(line)).map(line=>{const at=line.indexOf("=");let value=line.slice(at+1).trim();if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);return[line.slice(0,at),value];}));},{});
 snapshot.isolated=safe(()=>{
  if(!snapshot.identity||environment.DOCKER_HOST&&environment.DOCKER_HOST!==env.DOCKER_HOST||settings.DOCKER_HOST!==env.DOCKER_HOST||settings.LUMINA_DOCKER_DATA_ROOT!==HOST_PATHS.dockerRoot||environment.DOCKER_CONTEXT||environment.DOCKER_CONFIG&&environment.DOCKER_CONFIG!==env.DOCKER_CONFIG||environment.BUILDX_CONFIG&&environment.BUILDX_CONFIG!==env.BUILDX_CONFIG)throw new Error("DOCKER_SCOPE_INVALID");
  const socket=stat(`/run/user/${uid}/docker.sock`);if(!socket.isSocket()||socket.uid!==uid||socket.isSymbolicLink())throw new Error("SOCKET_OWNER_INVALID");
  for(const directory of [HOST_PATHS.dockerConfig,HOST_PATHS.buildxConfig,HOST_PATHS.dockerRoot]){const meta=stat(directory);if(!meta.isDirectory()||meta.isSymbolicLink()||meta.uid!==uid||realpath(directory)!==directory||(meta.mode&0o077)!==0)throw new Error("DOCKER_DIRECTORY_INVALID");}
  const info=JSON.parse(command("/usr/bin/docker",["info","--format","{{json .}}"],env));snapshot.versions.docker=info.ServerVersion;
  if(info.DockerRootDir!==HOST_PATHS.dockerRoot||info.CgroupDriver!=="systemd"||String(info.CgroupVersion)!=="2"||!info.SecurityOptions?.includes("name=rootless"))throw new Error("ROOTLESS_INFO_INVALID");return true;
 },false);
 if(snapshot.isolated){
  snapshot.capabilities=probeHostCapabilities(run,env);
  snapshot.dockerServiceReady=safe(()=>{const status=command("/usr/bin/systemctl",["--user","show","docker.service","--property=LoadState,ActiveState","--no-pager"],{...env,XDG_RUNTIME_DIR:`/run/user/${uid}`,DBUS_SESSION_BUS_ADDRESS:`unix:path=/run/user/${uid}/bus`});return /^LoadState=loaded$/m.test(status)&&/^ActiveState=active$/m.test(status);},false);
  snapshot.versions.compose=safe(()=>command("/usr/bin/docker",["compose","version","--short"],env).replace(/^v/,""));
  snapshot.versions.buildx=safe(()=>/\bv?(\d+\.\d+\.\d+(?:[+-][0-9A-Za-z.+~-]+)?)/.exec(command("/usr/bin/docker",["buildx","version"],env))?.[1]);
  snapshot.builder=safe(()=>{
   const markerPath=`${HOST_PATHS.storage}/builder-owner.json`,meta=stat(markerPath);if(!meta.isFile()||meta.isSymbolicLink()||meta.uid!==uid||(meta.mode&0o077)!==0||realpath(markerPath)!==markerPath)throw new Error("MARKER_INVALID");
   const inspect=command("/usr/bin/docker",["buildx","inspect",HOST_CONTRACT.builder.name],env);
   const config=rootFile(HOST_PATHS.buildkitConfig),policy=[["reservedSpace",settings.LUMINA_BUILDKIT_RESERVED_CACHE_GB??2,"GB",1,128],["maxUsedSpace",settings.LUMINA_BUILDKIT_MAX_CACHE_GB??12,"GB",2,512],["minFreeSpace",settings.LUMINA_DOCKER_MIN_FREE_GB??10,"GB",2,1024],["keepDuration",settings.LUMINA_BUILDKIT_CACHE_RETENTION_HOURS??24,"h",24,2160]];
   if(policy.some(([key,value,suffix,minimum,maximum])=>!/^\d+$/.test(String(value))||Number(value)<minimum||Number(value)>maximum||!config.includes(`${key} = "${value}${suffix}"`)))throw new Error("BUILDER_POLICY_FINGERPRINT_INVALID");
   if(Number(policy[0][1])>=Number(policy[1][1]))throw new Error("BUILDER_POLICY_FINGERPRINT_INVALID");
   return{marker:JSON.parse(read(markerPath,"utf8")),inspect,endpoint:env.DOCKER_HOST,fingerprint:sha256(config),proxy:parseDockerBuildProxy(settings.LUMINA_DOCKER_PROXY??""),image:/\bimage="([^"]+)"/.exec(inspect)?.[1]??null};
  },{});
  snapshot.builderDaemon=safe(()=>{const value=JSON.parse(command("/usr/bin/docker",["container","inspect","buildx_buildkit_lumina-crm-buildkit0"],env));if(!Array.isArray(value)||value.length!==1)throw new Error("BUILDER_DAEMON_INVALID");return{image:value[0].Config?.Image,network:value[0].HostConfig?.NetworkMode,operationId:value[0].Config?.Env?.find(value=>value.startsWith("LUMINA_HOST_OPERATION_ID="))?.slice("LUMINA_HOST_OPERATION_ID=".length)??null};});
 }
 snapshot.maintenanceTrust=safe(()=>inspectMaintenanceTrust(rootFile));
 snapshot.maintenanceDigest=snapshot.maintenanceTrust?.digest??null;
 snapshot.unitsReady=safe(()=>HOST_UNIT_PATHS.every(unit=>{const expected=unitSources?.[unit]??read(path.join(sourceRoot,"deploy/systemd",unit),"utf8");const installed=rootFile(`/etc/systemd/system/${unit}`);if(!trustedUnit(unit,installed,expected))return false;const status=command("/usr/bin/systemctl",["show",unit,"--property=LoadState,NeedDaemonReload,DropInPaths,User,FragmentPath","--no-pager"]),fields=Object.fromEntries(status.split(/\r?\n/).map(line=>{const at=line.indexOf("=");return[line.slice(0,at),line.slice(at+1)];}));return fields.LoadState==="loaded"&&fields.NeedDaemonReload==="no"&&fields.DropInPaths===""&&fields.User==="lumina-crm"&&fields.FragmentPath===`/etc/systemd/system/${unit}`;}),false);
 snapshot.operationPending=safe(()=>{const file=`${HOST_PATHS.storage}/host-upgrade-active.json`;try{const meta=stat(file);if(!meta.isFile()||meta.isSymbolicLink()||meta.uid!==uid||realpath(file)!==file)return true;}catch(error){if(error.code==="ENOENT")return false;throw error;}return JSON.parse(read(file,"utf8")).stage!=="COMPLETE";},true);
 const lockFree=file=>safe(()=>{const meta=stat(file);if(!meta.isFile()||meta.isSymbolicLink()||meta.uid!==uid||realpath(file)!==file||(meta.mode&0o022)!==0)return false;return run("/usr/bin/flock",["--nonblock","--exclusive",file,"/usr/bin/true"],env).status===0;},false);
 snapshot.admissionLockReady=safe(()=>{const meta=stat(HOST_PATHS.admissionLock);return meta.isFile()&&!meta.isSymbolicLink()&&meta.uid===uid&&(meta.mode&0o022)===0&&realpath(HOST_PATHS.admissionLock)===HOST_PATHS.admissionLock;},false);
 snapshot.deployLockFree=lockFree(HOST_PATHS.deployLock);snapshot.maintenanceLockFree=lockFree(HOST_PATHS.maintenanceLock);
 snapshot.diskReady=safe(()=>{
  const percent=Number(settings.LUMINA_DEPLOY_MIN_FREE_PERCENT??15);if(!Number.isInteger(percent)||percent<5||percent>50)return false;
  const paths=[["/",Number(settings.LUMINA_ROOT_MIN_FREE_GB??8)],[HOST_PATHS.dockerRoot,Number(settings.LUMINA_DOCKER_MIN_FREE_GB??10)],[HOST_PATHS.state,Number(settings.LUMINA_STATE_MIN_FREE_GB??4)]];
  snapshot.disk=paths.map(([file,minimum])=>{if(!Number.isSafeInteger(minimum)||minimum<2||minimum>1024)throw new Error("DISK_POLICY_INVALID");const value=statfs(file);return{path:file,availableBytes:Number(value.bavail)*Number(value.bsize),minimumBytes:minimum*1024**3,freePercent:Number(value.bavail)/Number(value.blocks)*100,minimumPercent:percent};});return snapshot.disk.every(d=>d.availableBytes>=d.minimumBytes&&d.freePercent>=d.minimumPercent);
 },false);
 return snapshot;
}
export function hostPreflight({target=localHostTarget(),snapshot=collectHostSnapshot({unitSources:target.units}),executionLockHeld=false}={}){return evaluateHostSnapshot(snapshot,target,{executionLockHeld});}
export function assertHostPreflight(options){const result=hostPreflight(options);if(!result.ready)throw Object.assign(new Error("HOST_PREFLIGHT_FAILED"),{code:"HOST_PREFLIGHT_FAILED",diagnostics:result});return result;}
export function hostUpgradePlan(report){return{schemaVersion:1,contractRevision:report.contractRevision,readOnly:true,systemChanges:"Operator only: provision approved Node/npm/Docker/Compose/Buildx; never performed by deployment",cacheWarning:"Replacing the CRM builder may lose BuildKit cache. CRM data volumes and application images are excluded.",requiredActions:report.diagnostics.filter(row=>row.blocking).map(row=>({component:row.component,current:row.current,required:row.required,recommended:row.recommended??null,remediation:row.remediation}))};}
export function pendingHostOperation(){const file=`${HOST_PATHS.storage}/host-upgrade-active.json`;if(!existsSync(file))return false;try{return JSON.parse(readFileSync(file,"utf8")).stage!=="COMPLETE";}catch{return true;}}
