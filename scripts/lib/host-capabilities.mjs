// All probes are help, inspection or local Compose model normalization. No build/up/prune runs.
export const REQUIRED_DOCKER_CAPABILITIES=Object.freeze([
 {id:"compose.project",args:["compose","--help"],flags:["--project-name","--env-file","--file","--profile"]},
 {id:"compose.up",args:["compose","up","--help"],flags:["--no-deps","--force-recreate","--detach","--wait","--wait-timeout"]},
 {id:"compose.run",args:["compose","run","--help"],flags:["--rm","--no-deps","--entrypoint"]},
 {id:"compose.config",args:["compose","config","--help"],flags:["--format","--no-interpolate"]},
 {id:"buildx.build",args:["buildx","build","--help"],flags:["--builder","--build-arg","--provenance","--target","--output","--load","--tag","--file"]},
 {id:"buildx.inspect",args:["buildx","inspect","--help"],flags:["--bootstrap"]},
 {id:"buildx.cache",args:["buildx","prune","--help"],flags:["--filter","--max-used-space","--reserved-space","--min-free-space","--force"]},
]);
export const CAPABILITY_COMPOSE_MODEL=`name: lumina-capability-check
services:
  web:
    image: example.invalid/fictional-crm:capability
    user: "10001:10001"
    init: true
    read_only: true
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    pids_limit: 256
    mem_limit: 512m
    cpus: 1
    tmpfs: ["/tmp:rw,noexec,nosuid,nodev"]
    networks: [backend]
    healthcheck:
      test: [CMD, /bin/true]
    ports: ["127.0.0.1:3200:3200"]
networks:
  backend:
    internal: true
`;
export const COMPOSE_SECURITY_ARGUMENTS=Object.freeze(["compose","--project-name","lumina-capability-check","--file","-","config","--format","json","--no-interpolate"]);
const kind=value=>value===null?"null":Array.isArray(value)?"array":typeof value;
const record=value=>kind(value)==="object";
const numberEquals=(value,expected)=>(typeof value==="number"||typeof value==="string"&&/^\d+(?:\.\d+)?$/.test(value))&&Number(value)===expected;
function memoryBytes(value){
 if(typeof value==="number")return Number.isSafeInteger(value)&&value>=0?BigInt(value):null;
 if(typeof value!=="string"||value.length>64)return null;
 const match=/^(\d+)(?:\.(\d{1,6}))?([kmgt]?)(?:b)?$/i.exec(value.trim());if(!match)return null;
 const fraction=match[2]??"",scale=10n**BigInt(fraction.length),unit={"":1n,k:1024n,m:1024n**2n,g:1024n**3n,t:1024n**4n}[match[3].toLowerCase()],bytes=BigInt(match[1]+fraction)*unit;
 return bytes%scale===0n?bytes/scale:null;
}

export function composeSecurityDiagnostics(model){
 const diagnostics=[],web=record(model?.services?.web)?model.services.web:{},backend=model?.networks?.backend;
 const check=(field,value,expected,ok)=>{if(!ok)diagnostics.push({field,code:"COMPOSE_SECURITY_FIELD_MISMATCH",expected,observed:{type:kind(value),present:value!==undefined},remediation:"The normalized fictional Compose model must preserve this security field; review the parser output privately."});};
 check("services.web",model?.services?.web,"service object",record(model?.services?.web));
 check("services.web.user",web.user,"10001:10001",web.user==="10001:10001");
 check("services.web.init",web.init,true,web.init===true);
 check("services.web.read_only",web.read_only,true,web.read_only===true);
 check("services.web.cap_drop",web.cap_drop,["ALL"],Array.isArray(web.cap_drop)&&web.cap_drop.length===1&&web.cap_drop[0]==="ALL");
 check("services.web.cap_add",web.cap_add,"absent or empty",web.cap_add===undefined||Array.isArray(web.cap_add)&&web.cap_add.length===0);
 check("services.web.privileged",web.privileged,"absent or false",web.privileged===undefined||web.privileged===false);
 check("services.web.security_opt",web.security_opt,"one enabled no-new-privileges option",Array.isArray(web.security_opt)&&web.security_opt.length===1&&typeof web.security_opt[0]==="string"&&/^no-new-privileges(?::true|=true)?$/.test(web.security_opt[0]));
 check("services.web.pids_limit",web.pids_limit,256,numberEquals(web.pids_limit,256));
 check("services.web.mem_limit",web.mem_limit,536870912,memoryBytes(web.mem_limit)===536870912n);
 check("services.web.cpus",web.cpus,1,numberEquals(web.cpus,1));
 const mounts=Array.isArray(web.tmpfs)?web.tmpfs:[],tmp=mounts.length===1&&typeof mounts[0]==="string"&&mounts[0].startsWith("/tmp:")?mounts[0]:null;
 check("services.web.tmpfs",web.tmpfs,"one /tmp mount with explicit options",Boolean(tmp));
 const options=new Set(tmp?.slice("/tmp:".length).split(",")??[]);
 for(const [required,opposite] of [["rw","ro"],["noexec","exec"],["nosuid","suid"],["nodev","dev"]])check(`services.web.tmpfs.${required}`,web.tmpfs,`/tmp includes ${required} without ${opposite}`,Boolean(tmp)&&options.has(required)&&!options.has(opposite));
 check("networks.backend.internal",backend?.internal,true,backend?.internal===true);
 check("services.web.networks",web.networks,"only backend",record(web.networks)&&Object.keys(web.networks).length===1&&Object.hasOwn(web.networks,"backend"));
 const port=Array.isArray(web.ports)&&web.ports.length===1&&record(web.ports[0])?web.ports[0]:{};
 check("services.web.ports",web.ports,"one explicit port mapping",Array.isArray(web.ports)&&web.ports.length===1&&record(web.ports[0]));
 check("services.web.ports.host_ip",port.host_ip,"127.0.0.1",port.host_ip==="127.0.0.1");
 check("services.web.ports.target",port.target,3200,numberEquals(port.target,3200));
 check("services.web.ports.published",port.published,3200,numberEquals(port.published,3200));
 check("services.web.ports.protocol",port.protocol,"tcp",port.protocol==="tcp");
 return diagnostics;
}
export function validateComposeCapabilities(model){
 const diagnostics=composeSecurityDiagnostics(model);
 if(diagnostics.length)throw Object.assign(new Error("COMPOSE_SECURITY_MODEL_UNSUPPORTED"),{code:"COMPOSE_SECURITY_MODEL_UNSUPPORTED",diagnostics});
 return true;
}
function commandFailure(result){
 const reasons={ENOENT:"NOT_FOUND",EACCES:"NOT_EXECUTABLE",ETIMEDOUT:"TIMEOUT",ENOBUFS:"OUTPUT_LIMIT"};
 return{status:"COMMAND_FAILED",code:"COMPOSE_CONFIG_COMMAND_FAILED",reason:reasons[result.error?.code]??(Number.isInteger(result.status)?"NONZERO_EXIT":"EXECUTION_FAILED"),exitCode:Number.isSafeInteger(result.status)?result.status:null};
}
export function probeComposeSecurityModel(run,environment){
 const failure=(status,code,diagnostics=[])=>({id:"compose.security-model",status,code,missing:diagnostics.map(value=>value.field).filter(Boolean),diagnostics});
 let result;
 try{result=run("/usr/bin/docker",[...COMPOSE_SECURITY_ARGUMENTS],environment,CAPABILITY_COMPOSE_MODEL);}
 catch(error){return{id:"compose.security-model",...commandFailure({error}),missing:[],diagnostics:[]};}
 if(result?.error||result?.status!==0){
  const stderr=String(result?.stderr??"");
  if(!result?.error&&/\byaml:|yaml\.parser|did not find expected|mapping values are not allowed|cannot unmarshal|unmarshal errors/i.test(stderr))return failure("YAML_INVALID","COMPOSE_CONFIG_YAML_INVALID");
  if(!result?.error&&/validating .+:|additional propert(?:y|ies)|must be a (?:list|mapping|boolean)/i.test(stderr))return failure("MODEL_INVALID","COMPOSE_CONFIG_MODEL_INVALID");
  return{id:"compose.security-model",...commandFailure(result??{}),missing:[],diagnostics:[]};
 }
 let model;try{model=JSON.parse(String(result.stdout??""));}catch{return failure("JSON_INVALID","COMPOSE_CONFIG_JSON_INVALID");}
 if(!record(model))return failure("JSON_INVALID","COMPOSE_CONFIG_JSON_SHAPE_INVALID");
 const diagnostics=composeSecurityDiagnostics(model);
 if(diagnostics.length)return failure("SECURITY_MISMATCH","COMPOSE_SECURITY_MODEL_UNSUPPORTED",diagnostics);
 return{id:"compose.security-model",status:"VERIFIED",missing:[],diagnostics:[]};
}
export function probeHostCapabilities(run,environment,{scope="full"}={}){
 if(!["full","deployment"].includes(scope))throw new Error("HOST_CAPABILITY_SCOPE_INVALID");
 const results=[];
 for(const probe of REQUIRED_DOCKER_CAPABILITIES){
  // The runner inspects an existing builder; only operator maintenance bootstraps or prunes it.
  if(scope==="deployment"&&probe.id==="buildx.cache")continue;
  const flags=scope==="deployment"&&probe.id==="buildx.inspect"?[]:probe.flags;
  try{const result=run("/usr/bin/docker",probe.args,environment),text=String(result.stdout??"");const missing=flags.filter(flag=>!new RegExp(`(?:^|\\s)${flag}(?:[=\\s,]|$)`).test(text));results.push({id:probe.id,status:result.status===0&&!result.error&&!missing.length?"VERIFIED":result.status!==0||result.error?"COMMAND_FAILED":"MISSING",missing:result.status===0?missing:flags});}
  catch{results.push({id:probe.id,status:"COMMAND_FAILED",missing:flags});}
 }
 results.push(probeComposeSecurityModel(run,environment));
 return{profile:"crm-compose-buildx-v1",scope,ready:results.every(value=>value.status==="VERIFIED"),results};
}
