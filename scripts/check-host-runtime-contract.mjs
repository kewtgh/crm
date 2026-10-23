import {readFileSync} from "node:fs";
import {HOST_CONTRACT} from "../deploy/libexec/lumina-host-contract.mjs";
import {localHostTarget} from "./lib/host-preflight.mjs";
localHostTarget();
for(const file of ["infrastructure/email-delivery-worker/package.json","planning-source/education-intelligent-crm-planning-v1/package.json"]){const pkg=JSON.parse(readFileSync(file,"utf8"));if(pkg.engines.node!==HOST_CONTRACT.components.node.required||pkg.engines.npm!==HOST_CONTRACT.components.npm.required||pkg.packageManager!==`npm@${HOST_CONTRACT.components.npm.recommended}`)throw new Error("HOST_MANIFEST_ALIGNMENT_FAILED");}
const docker=readFileSync("Dockerfile","utf8");if(!docker.includes(`node:${HOST_CONTRACT.components.node.recommended}-`)||!docker.includes(`npm@${HOST_CONTRACT.components.npm.recommended}`))throw new Error("HOST_DOCKER_ALIGNMENT_FAILED");
for(const file of ["ci.yml","full-release-gate.yml","public-privacy.yml"]){const text=readFileSync(`.github/workflows/${file}`,"utf8");const pins=[...text.matchAll(/npm install --global npm@([\d.]+)/g)];if(!text.includes("node-version-file: .nvmrc")||!pins.length||pins.some(match=>match[1]!==HOST_CONTRACT.components.npm.recommended))throw new Error("HOST_CI_ALIGNMENT_FAILED");}
console.log(`Host contract aligned: ${HOST_CONTRACT.revision}`);
