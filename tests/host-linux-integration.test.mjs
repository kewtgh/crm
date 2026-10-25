import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import {mkdtempSync,writeFileSync,rmSync,readFileSync,lstatSync} from "node:fs";
import {spawnSync} from "node:child_process";
import os from "node:os";
import path from "node:path";
import {hostLocksHeld} from "../deploy/libexec/lumina-host-upgrade.mjs";
import {HOST_PATHS} from "../deploy/libexec/lumina-host-contract.mjs";
import {writeExclusiveRequest} from "../scripts/lib/production-deploy-core.mjs";

const linux={skip:process.platform!=="linux"?"NOT_RUN: native Linux filesystem and kernel required":false};
test("native Linux request admission creates exactly one exclusive request without replacing it",linux,async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),"fictional-v1-admission-"));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const file=path.join(directory,"request.json"),requests=[{requestId:"fictional-a"},{requestId:"fictional-b"}];
 const results=await Promise.allSettled(requests.map(request=>writeExclusiveRequest(fs,file,request)));
 assert.equal(results.filter(result=>result.status==="fulfilled").length,1);
 const winner=results.findIndex(result=>result.status==="fulfilled");assert.deepEqual(JSON.parse(await fs.readFile(file,"utf8")),requests[winner]);
 assert.match(results[1-winner].reason.message,/already pending or running/);
});

test("native Linux flock proves ancestor ownership and excludes an independent contender",linux,t=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),"fictional-v1-lock-"));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const lock=path.join(directory,"request.lock");writeFileSync(lock,"",{mode:0o600});
 // Translate only the fixture pathname. /proc ancestry, device/inode, flock and
 // contender processes are real; no fixed production lock is opened or created.
 const helper=`import {lstatSync} from 'node:fs';import {spawnSync} from 'node:child_process';import {hostLocksHeld} from ${JSON.stringify(new URL("../deploy/libexec/lumina-host-upgrade.mjs",import.meta.url).href)};const file=process.argv[1],fixed=${JSON.stringify(HOST_PATHS.admissionLock)};if(!hostLocksHeld([fixed],{stat:()=>lstatSync(file),realpath:()=>fixed}))process.exit(2);const result=spawnSync('/usr/bin/flock',['--nonblock','--exclusive','--conflict-exit-code=73',file,'/usr/bin/true']);if(result.status!==73)process.exit(3);`;
 const result=spawnSync("/usr/bin/flock",["--nonblock","--exclusive",lock,process.execPath,"--input-type=module","-e",helper,lock],{encoding:"utf8",timeout:10000});
 assert.equal(result.status,0,"Kernel ownership and exclusion must both hold");
 assert.equal(hostLocksHeld([HOST_PATHS.admissionLock],{stat:()=>lstatSync(lock),realpath:()=>HOST_PATHS.admissionLock}),false);
 const released=spawnSync("/usr/bin/flock",["--nonblock","--exclusive",lock,"/usr/bin/true"],{timeout:3000});assert.equal(released.status,0);
 assert.equal(readFileSync(lock,"utf8"),"");
});
