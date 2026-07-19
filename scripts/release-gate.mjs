import { spawn, spawnSync } from "node:child_process";

process.env.DO_NOT_TRACK="1";
process.env.SUPABASE_TELEMETRY_DISABLED="1";

const appUrl=(process.env.APP_URL??"http://127.0.0.1:3200").replace(/\/$/,"");
const npmCli=process.env.npm_execpath;
if(!npmCli)throw new Error("npm_execpath is required; run this gate through npm run release:gate");

function run(command,args){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{env:process.env,stdio:"inherit"});
    child.once("error",reject);
    child.once("exit",(code)=>code===0?resolve():reject(new Error(`${command} ${args.join(" ")} exited with ${code}`)));
  });
}
const runNpm=(args)=>run(process.execPath,[npmCli,...args]);
const runSupabase=(args)=>runNpm(["exec","--","supabase",...args]);

function assertServerRunning(server){
  if(server.exitCode!==null){
    throw new Error(`Application server exited before smoke tests (code ${server.exitCode})`);
  }
}

async function waitForApp(server){
  const deadline=Date.now()+120_000;
  while(Date.now()<deadline){
    assertServerRunning(server);
    let healthy=false;
    try{
      const response=await fetch(`${appUrl}/api/health`,{signal:AbortSignal.timeout(3_000)});
      healthy=response.ok;
    }catch{}
    if(healthy){
      await new Promise(resolve=>setTimeout(resolve,100));
      assertServerRunning(server);
      return;
    }
    await new Promise(resolve=>setTimeout(resolve,1_000));
  }
  throw new Error(`Application did not become healthy at ${appUrl}`);
}

function stopTree(child){
  if(!child?.pid)return;
  if(process.platform==="win32"){
    spawnSync("taskkill",["/pid",String(child.pid),"/T","/F"],{stdio:"ignore"});
  }else{
    try{process.kill(-child.pid,"SIGTERM");}catch{child.kill("SIGTERM");}
  }
}

await runNpm(["run","typecheck"]);
await runNpm(["run","lint"]);
await runNpm(["test"]);
await runNpm(["audit","--audit-level=moderate"]);
await runSupabase(["db","lint","--local","--level","warning"]);
await runSupabase(["test","db","--local"]);
await runNpm(["run","smoke:phase2"]);
await runNpm(["run","smoke:v09"]);

const server=spawn(process.execPath,[npmCli,"run","start","--","--port","3200"],{
  env:{...process.env,APP_URL:appUrl},
  stdio:"inherit",
  detached:process.platform!=="win32",
});
try{
  await waitForApp(server);
  await runNpm(["run","qa:assets"]);
  await runNpm(["run","smoke:http-v09"]);
  assertServerRunning(server);
  await runNpm(["run","smoke:http-v10"]);
  assertServerRunning(server);
await runNpm(["run","smoke:v11"]);
await runNpm(["run","smoke:exports"]);
  process.env.AUTH_SMOKE_BASE_URL=appUrl;
  await runNpm(["run","smoke:auth-device"]);
  assertServerRunning(server);
  await runNpm(["run","qa:chromium-1228"]);
}finally{
  stopTree(server);
}

process.stdout.write("\nRelease gate passed: types, lint, build, dependency audit, Node, pgTAP, schema lint, smokes, production assets, and ms-playwright/chromium-1228 UI QA.\n");
