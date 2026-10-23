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
    tmpfs: [/tmp:rw,noexec,nosuid,nodev]
    networks: [backend]
    healthcheck:
      test: [CMD, /bin/true]
    ports: ["127.0.0.1:3200:3200"]
networks:
  backend:
    internal: true
`;
export function validateComposeCapabilities(model){
 const web=model?.services?.web,network=model?.networks?.backend;
 if(!web||web.user!=="10001:10001"||web.init!==true||web.read_only!==true||!web.cap_drop?.includes("ALL")||!web.security_opt?.some(v=>/^no-new-privileges(?::true|=true)?$/.test(v))||Number(web.pids_limit)!==256||Number(web.mem_limit)!==536870912||Number(web.cpus)!==1||!web.tmpfs?.some(v=>v.includes("noexec")&&v.includes("nosuid"))||network?.internal!==true||web.ports?.[0]?.host_ip!=="127.0.0.1")throw new Error("COMPOSE_SECURITY_MODEL_UNSUPPORTED");
 return true;
}
export function probeHostCapabilities(run,environment){
 const results=[];
 for(const probe of REQUIRED_DOCKER_CAPABILITIES){
  try{const result=run("/usr/bin/docker",probe.args,environment),text=String(result.stdout??"");const missing=probe.flags.filter(flag=>!new RegExp(`(?:^|\\s)${flag}(?:[=\\s,]|$)`).test(text));results.push({id:probe.id,status:result.status===0&&!result.error&&!missing.length?"VERIFIED":"MISSING",missing:result.status===0?missing:probe.flags});}
  catch{results.push({id:probe.id,status:"NOT_CHECKED",missing:probe.flags});}
 }
 try{const result=run("/usr/bin/docker",["compose","--project-name","lumina-capability-check","--file","-","config","--format","json","--no-interpolate"],environment,CAPABILITY_COMPOSE_MODEL);if(result.status!==0||result.error)throw new Error("COMPOSE_MODEL_FAILED");validateComposeCapabilities(JSON.parse(result.stdout));results.push({id:"compose.security-model",status:"VERIFIED",missing:[]});}
 catch{results.push({id:"compose.security-model",status:"MISSING",missing:["security-preserving config normalization"]});}
 return{profile:"crm-compose-buildx-v1",ready:results.every(value=>value.status==="VERIFIED"),results};
}
