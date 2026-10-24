import test from "node:test";
import assert from "node:assert/strict";
import {composeSecurityDiagnostics,validateComposeCapabilities,probeComposeSecurityModel,probeHostCapabilities,REQUIRED_DOCKER_CAPABILITIES} from "../scripts/lib/host-capabilities.mjs";
import {describeTransitionFailure} from "../scripts/lib/legacy-transition-host.mjs";

const clone=value=>JSON.parse(JSON.stringify(value));
const normalized={services:{web:{user:"10001:10001",init:true,read_only:true,cap_drop:["ALL"],security_opt:["no-new-privileges:true"],pids_limit:256,mem_limit:"512m",cpus:1,tmpfs:["/tmp:rw,noexec,nosuid,nodev"],networks:{backend:null},ports:[{host_ip:"127.0.0.1",target:3200,published:"3200",protocol:"tcp"}]}},networks:{backend:{internal:true}}};
const response=model=>({status:0,stdout:JSON.stringify(model)});

test("Compose memory representations preserve exactly 512 MiB with no rounding or limit bypass",()=>{
 for(const mem_limit of [536870912,"536870912","536870912b","512m","512M","512mb","0.5g","524288k"]){const model=clone(normalized);model.services.web.mem_limit=mem_limit;assert.equal(validateComposeCapabilities(model),true);}
 for(const mem_limit of [536870911,536870913,"512000000","511m","513m","536870912.1",true,null,"512m-secret","1e9",Infinity]){const model=clone(normalized);model.services.web.mem_limit=mem_limit;assert.ok(composeSecurityDiagnostics(model).some(row=>row.field==="services.web.mem_limit"));}
});
test("each normalized security field has an independent redacted mismatch diagnostic",()=>{
 const cases=[
  [m=>m.services.web=null,"services.web"],[m=>m.services.web.user="fictional-private-value","services.web.user"],
  [m=>m.services.web.init=false,"services.web.init"],[m=>m.services.web.read_only=false,"services.web.read_only"],
  [m=>m.services.web.cap_drop=[],"services.web.cap_drop"],[m=>m.services.web.cap_add=["ALL"],"services.web.cap_add"],
  [m=>m.services.web.privileged=true,"services.web.privileged"],[m=>m.services.web.security_opt=["no-new-privileges:false"],"services.web.security_opt"],
  [m=>m.services.web.pids_limit=255,"services.web.pids_limit"],[m=>m.services.web.mem_limit="511m","services.web.mem_limit"],[m=>m.services.web.cpus=0.5,"services.web.cpus"],
  [m=>m.services.web.tmpfs=["/other:rw,noexec,nosuid,nodev"],"services.web.tmpfs"],
  [m=>m.services.web.tmpfs=["/tmp:ro,noexec,nosuid,nodev"],"services.web.tmpfs.rw"],
  [m=>m.services.web.tmpfs=["/tmp:rw,nosuid,nodev"],"services.web.tmpfs.noexec"],
  [m=>m.services.web.tmpfs=["/tmp:rw,noexec,nodev"],"services.web.tmpfs.nosuid"],
  [m=>m.services.web.tmpfs=["/tmp:rw,noexec,nosuid"],"services.web.tmpfs.nodev"],
  [m=>m.networks.backend.internal=false,"networks.backend.internal"],[m=>m.services.web.networks={default:null},"services.web.networks"],
  [m=>m.services.web.ports=[],"services.web.ports"],[m=>m.services.web.ports[0].host_ip="0.0.0.0","services.web.ports.host_ip"],
  [m=>m.services.web.ports[0].target=3201,"services.web.ports.target"],[m=>m.services.web.ports[0].published="3201","services.web.ports.published"],
  [m=>m.services.web.ports[0].protocol="udp","services.web.ports.protocol"],
 ];
 for(const [change,field] of cases){const model=clone(normalized);change(model);const result=probeComposeSecurityModel(()=>response(model),{});assert.equal(result.status,"SECURITY_MISMATCH");assert.ok(result.diagnostics.some(row=>row.field===field),field);assert.ok(!JSON.stringify(result).includes("fictional-private-value"));assert.throws(()=>validateComposeCapabilities(model),error=>error.code==="COMPOSE_SECURITY_MODEL_UNSUPPORTED"&&error.diagnostics.some(row=>row.field===field));}
});
test("tmpfs protection requires complete option tokens and rejects conflicting overrides",()=>{
 for(const options of ["rw,fakenoexec,nosuid,nodev","rw,noexec,fakenosuid,nodev","rw,noexec,nosuid,fakenodev","rw,noexec,nosuid,nodev,exec","rw,noexec,nosuid,nodev,suid","rw,noexec,nosuid,nodev,dev"]){const model=clone(normalized);model.services.web.tmpfs=[`/tmp:${options}`];assert.equal(probeComposeSecurityModel(()=>response(model),{}).status,"SECURITY_MISMATCH");}
});
test("Compose execution, YAML, model, JSON and security errors have distinct safe classifications",()=>{
 const marker="fictional-private-value";
 const cases=[
  [{status:1,stderr:`connection refused ${marker}`},"COMMAND_FAILED","COMPOSE_CONFIG_COMMAND_FAILED"],
  [{status:1,stderr:`yaml: line 2: did not find expected key ${marker}`},"YAML_INVALID","COMPOSE_CONFIG_YAML_INVALID"],
  [{status:1,stderr:`validating -: services.web.tmpfs must be a list ${marker}`},"MODEL_INVALID","COMPOSE_CONFIG_MODEL_INVALID"],
  [{status:0,stdout:`{"${marker}"`},"JSON_INVALID","COMPOSE_CONFIG_JSON_INVALID"],
  [{status:0,stdout:"null"},"JSON_INVALID","COMPOSE_CONFIG_JSON_SHAPE_INVALID"],
  [response({services:{web:{user:marker}}}),"SECURITY_MISMATCH","COMPOSE_SECURITY_MODEL_UNSUPPORTED"],
 ];
 for(const [raw,status,code] of cases){const result=probeComposeSecurityModel(()=>raw,{});assert.equal(result.status,status);assert.equal(result.code,code);assert.ok(!JSON.stringify(result).includes(marker));}
 for(const code of ["ENOENT","EACCES","ETIMEDOUT","ENOBUFS"]){const result=probeComposeSecurityModel(()=>{throw Object.assign(new Error(marker),{code});},{});assert.equal(result.status,"COMMAND_FAILED");assert.ok(!JSON.stringify(result).includes(marker));}
});
test("all capabilities can be verified while any probe error remains blocking",()=>{
 const run=(command,args)=>args.includes("--help")?{status:0,stdout:REQUIRED_DOCKER_CAPABILITIES.find(value=>JSON.stringify(value.args)===JSON.stringify(args)).flags.join(" ")}:response(normalized);
 assert.equal(probeHostCapabilities(run,{}).ready,true);
 const failed=probeHostCapabilities((command,args)=>args.includes("--help")?run(command,args):{status:0,stdout:"invalid-json"},{});assert.equal(failed.ready,false);assert.equal(failed.results.at(-1).status,"JSON_INVALID");
});
test("adopt failures expose field diagnostics without echoing command stderr or arbitrary host data",()=>{
 const model=clone(normalized);model.services.web.user="fictional-private-value";const capability=probeComposeSecurityModel(()=>response(model),{});
 const result=describeTransitionFailure(Object.assign(new Error("HOST_PREFLIGHT_FAILED"),{code:"HOST_PREFLIGHT_FAILED",stderr:"fictional-private-value",diagnostics:{diagnostics:[{component:"docker.capabilities",current:{results:[capability]}},{component:"private",current:"fictional-private-value"}]}}));
 assert.equal(result.hostCapabilities[0].diagnostics[0].field,"services.web.user");assert.ok(!JSON.stringify(result).includes("fictional-private-value"));
});
