import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {prepareComposeCapabilityRuntime} from "./prepare-compose-capability-runtime.mjs";
// Docker's source-only verification uses :raw. Host/CI verification additionally
// runs immutable cross-commit integration against real Git objects and Git itself.
const manifest=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
const args=manifest.scripts["test:deploy:raw"].split(" ").slice(1);
const compose=await prepareComposeCapabilityRuntime();
const result=spawnSync(process.execPath,[...args,"tests/host-cross-commit.test.mjs","tests/compose-capabilities-integration.test.mjs"],{stdio:"inherit",env:{...process.env,LUMINA_COMPOSE_2403_PATH:compose},windowsHide:true});
if(result.error)throw result.error;
process.exitCode=result.status??1;
