import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";

export const HOST_CONTRACT_PATH="deploy/libexec/host-runtime-contract.json";
export const MAINTENANCE_ASSETS=[HOST_CONTRACT_PATH,"deploy/libexec/lumina-host-contract.mjs","deploy/libexec/lumina-host-upgrade.mjs","deploy/libexec/lumina-crm-storage-maintenance.mjs"];
export const HOST_PATHS=Object.freeze({source:"/opt/lumina-crm/source",state:"/var/lib/lumina-crm/deployments",storage:"/var/lib/lumina-crm/storage-maintenance",dockerRoot:"/var/lib/lumina-crm/docker",dockerConfig:"/var/lib/lumina-crm/docker-config",buildxConfig:"/var/lib/lumina-crm/docker-config/buildx",admissionLock:"/var/lib/lumina-crm/request-admission.lock",deployLock:"/var/lib/lumina-crm/deploy.lock",maintenanceLock:"/var/lib/lumina-crm/maintenance.lock",program:"/usr/local/libexec/lumina-crm-storage-maintenance.mjs",bundles:"/usr/local/libexec/lumina-crm-host",buildkitConfig:"/etc/lumina-crm/buildkitd.toml"});
export const sha256=value=>createHash("sha256").update(value).digest("hex");
export function versionTuple(value){const match=/^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value));return match?match.slice(1).map(Number):null;}
export function compareVersions(a,b){const x=versionTuple(a),y=versionTuple(b);if(!x||!y)throw new Error("HOST_VERSION_INVALID");for(let n=0;n<3;n++){if(x[n]!==y[n])return Math.sign(x[n]-y[n]);}return 0;}
export function validateHostContract(value){
 if(!value||value.schemaVersion!==1||value.maintenanceProtocol!==1||!/^host-[\d.-]+$/.test(value.revision??""))throw new Error("HOST_CONTRACT_UNSUPPORTED");
 for(const key of ["node","npm","docker","compose","buildx"]){const rule=value.components?.[key];if(!rule||!versionTuple(rule.minimum)||!versionTuple(rule.maximumExclusive)||!versionTuple(rule.recommended)||compareVersions(rule.minimum,rule.maximumExclusive)>=0||compareVersions(rule.recommended,rule.minimum)<0||compareVersions(rule.recommended,rule.maximumExclusive)>=0||typeof rule.required!=="string"||rule.required.length>80||typeof rule.supported!=="string")throw new Error("HOST_CONTRACT_INVALID");const range=/^>=(\d+\.\d+\.\d+) <(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(rule.required);if(!range||range[1]!==rule.minimum||`${range[2]}.${range[3]??0}.${range[4]??0}`!==rule.maximumExclusive)throw new Error("HOST_CONTRACT_RANGE_INCONSISTENT");}
 if(value.builder?.name!=="lumina-crm-buildkit"||value.builder.driver!=="docker-container"||value.builder.network!=="host"||!/^moby\/buildkit:v\d+\.\d+\.\d+$/.test(value.builder.image))throw new Error("HOST_BUILDER_CONTRACT_INVALID");
 return value;
}
export const HOST_CONTRACT=validateHostContract(JSON.parse(readFileSync(new URL("./host-runtime-contract.json",import.meta.url),"utf8")));
export function componentDiagnostic(component,current,rule){const valid=versionTuple(current)&&compareVersions(current,rule.minimum)>=0&&compareVersions(current,rule.maximumExclusive)<0;return{component,current:current??null,required:rule.required,supported:rule.supported,recommended:rule.recommended,status:valid?(compareVersions(current,rule.recommended)<0?"SUPPORTED":"READY"):"INCOMPATIBLE",blocking:!valid,remediation:valid?null:`Operator upgrade required: ${component} ${rule.required}; recommended ${rule.recommended}`};}
export function maintenanceBundle(assets){
 if(Object.keys(assets).sort().join("\n")!==[...MAINTENANCE_ASSETS].sort().join("\n"))throw new Error("MAINTENANCE_ASSETS_INVALID");
 const hashes=Object.fromEntries(MAINTENANCE_ASSETS.map(file=>[file,sha256(assets[file])]));const digest=sha256(JSON.stringify(hashes));
 const launcher=`#!/usr/bin/env node\nimport {main} from '${HOST_PATHS.bundles}/${digest}/lumina-crm-storage-maintenance.mjs';\nawait main();\n`;
 return{digest,hashes,launcher,launcherSha256:sha256(launcher)};
}
export function parseBuilderOptions(output){
 const lines=[...String(output).matchAll(/^Driver Options:\s*(.+)$/gm)];if(lines.length!==1)throw new Error("LUMINA_BUILDKIT_CONFIGURATION_INVALID");
 const value=lines[0][1].trim(),options=new Map();let consumed="";
 for(const match of value.matchAll(/(?:^|\s)([^\s=]+)="([^"]*)"/g)){if(options.has(match[1]))throw new Error("LUMINA_BUILDKIT_CONFIGURATION_INVALID");options.set(match[1],match[2]);consumed+=match[0];}
 if(consumed.trim()!==value)throw new Error("LUMINA_BUILDKIT_CONFIGURATION_INVALID");return options;
}
export function validateOwnedBuilder({marker,inspect,fingerprint,proxy="",image=HOST_CONTRACT.builder.image,operationId=null,endpoint}){
 if(!marker||marker.owner!=="kewtgh/crm"||marker.builder!==HOST_CONTRACT.builder.name||marker.driver!=="docker-container"||marker.configSha256!==fingerprint||marker.builderNetworkMode!=="host"||Boolean(marker.dockerProxyEnabled)!==Boolean(proxy)||(marker.dockerProxySha256??null)!==(proxy?sha256(proxy):null))throw new Error("BUILDER_OWNERSHIP_UNVERIFIED");
 if(!/^Name:\s+lumina-crm-buildkit$/m.test(inspect)||!/^Driver:\s+docker-container$/m.test(inspect))throw new Error("LUMINA_BUILDKIT_DRIVER_CONFIGURATION_MISMATCH");
 const endpoints=[...String(inspect).matchAll(/^Endpoint:\s*(.+)$/gm)];if(!/^unix:\/\/\/run\/user\/[1-9]\d*\/docker\.sock$/.test(endpoint??"")||endpoints.length!==1||endpoints[0][1].trim()!==endpoint)throw new Error("BUILDER_ENDPOINT_ISOLATION_FAILED");
 const options=parseBuilderOptions(inspect),expected=new Map([["network","host"],["image",image]]);
 if(proxy)for(const key of ["HTTP_PROXY","HTTPS_PROXY","http_proxy","https_proxy"])expected.set(`env.${key}`,proxy);
 const nonce=operationId??marker.hostOperationId;if(nonce){if(!/^[0-9a-f-]{36}$/.test(nonce))throw new Error("BUILDER_OPERATION_INVALID");expected.set("env.LUMINA_HOST_OPERATION_ID",nonce);}
 if(options.get("image")!==image)throw new Error("LUMINA_BUILDKIT_IMAGE_CONFIGURATION_MISMATCH");
 if(options.size!==expected.size||[...expected].some(([key,value])=>options.get(key)!==value))throw new Error("LUMINA_BUILDKIT_CONFIGURATION_MISMATCH");
 return{image,operationId:nonce??null};
}
