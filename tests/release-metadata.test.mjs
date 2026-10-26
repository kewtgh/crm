import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { checkReleaseMetadata } from "../scripts/check-release-metadata.mjs";

function fixture(){const root={version:"1.2.3",dependencies:{react:"19.2.8"},devDependencies:{typescript:"5.9.3"},engines:{node:">=24 <25"}};return{packageText:JSON.stringify(root),lockText:JSON.stringify({version:root.version,packages:{"":root}}),versionSource:'export const APP_VERSION = "1.2.3";\n',readmeSource:'Current release candidate: **v1.2.3**',statusSource:'# Implementation status — v1.2.3 release candidate\n'};}

test("release preflight accepts aligned metadata and rejects stale lockfiles/dependencies/status",()=>{
  assert.equal(checkReleaseMetadata(fixture()),"1.2.3");
  const input=fixture(),lock=JSON.parse(input.lockText);
  lock.version="1.2.2";assert.throws(()=>checkReleaseMetadata({...input,lockText:JSON.stringify(lock)}),/package-lock.json version/);
  lock.version="1.2.3";lock.packages[""].version="1.2.2";assert.throws(()=>checkReleaseMetadata({...input,lockText:JSON.stringify(lock)}),/root package version/);
  lock.packages[""].version="1.2.3";lock.packages[""].dependencies.react="19.2.7";assert.throws(()=>checkReleaseMetadata({...input,lockText:JSON.stringify(lock)}),/dependencies/);
  assert.throws(()=>checkReleaseMetadata({...input,statusSource:'# Implementation status — v1.2.2 release candidate'}),/IMPLEMENTATION_STATUS/);
});

test("repository metadata is aligned and CI runs preflight before npm ci",async()=>{
  const files=["package.json","package-lock.json","lib/version.ts","README.md","docs/IMPLEMENTATION_STATUS.md",".github/workflows/ci.yml"];
  const [packageText,lockText,versionSource,readmeSource,statusSource,ci]=await Promise.all(files.map(file=>readFile(new URL(`../${file}`,import.meta.url),"utf8")));
  assert.equal(checkReleaseMetadata({packageText,lockText,versionSource,readmeSource,statusSource}),JSON.parse(packageText).version);
  assert.ok(ci.indexOf('node scripts/check-release-metadata.mjs')<ci.indexOf('npm ci --no-audit --no-fund'));
  for(const command of ['test:raw','test:contracts:raw'])assert.match(JSON.parse(packageText).scripts[command],/tests\/structured-inputs.test.mjs tests\/release-metadata.test.mjs/);
});

test("production candidates retain the complete Docker verification gate in development and CI",async()=>{
  const [packageText,docker,ci]=await Promise.all(["package.json","Dockerfile",".github/workflows/ci.yml"].map(file=>readFile(new URL(`../${file}`,import.meta.url),"utf8")));
  const command="docker build --progress=plain --target verification .";
  assert.equal(JSON.parse(packageText).scripts["release:verify"],command);
  const start=docker.indexOf("FROM build AS verification"),end=docker.indexOf("FROM node-toolchain AS production-dependencies",start);
  assert.ok(start>=0&&end>start);
  const stage=docker.slice(start,end),commands=["npm run typecheck:raw","npm run lint:raw","npm run test:contracts:raw","npm run test:deploy:raw"];
  for(let index=0;index<commands.length;index++){assert.ok(stage.includes(commands[index]),commands[index]);if(index)assert.ok(stage.indexOf(commands[index-1])<stage.indexOf(commands[index]));}
  assert.match(ci,/candidate-verification:[\s\S]*?runs-on: ubuntu-latest/);
  assert.ok(ci.includes(`run: ${command}`));
});
