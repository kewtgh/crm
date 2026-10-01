import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertReleaseVersionConsistency } from "./lib/release-version.mjs";

export function checkReleaseMetadata({packageText,lockText,versionSource,readmeSource,statusSource}) {
  const manifest=JSON.parse(packageText),lock=JSON.parse(lockText);
  const version=assertReleaseVersionConsistency({packageVersion:manifest.version,appVersionSource:versionSource,readmeSource});
  assert.equal(lock.version,version,"package-lock.json version must match package.json");
  assert.equal(lock.packages?.[""]?.version,version,"lockfile root package version must match package.json");
  for(const field of ["dependencies","devDependencies","engines"])assert.deepEqual(lock.packages[""][field],manifest[field],`lockfile root ${field} must match package.json; regenerate the lockfile`);
  assert.ok(statusSource.startsWith(`# Implementation status — v${version} release candidate`),"IMPLEMENTATION_STATUS release must match package.json");
  return version;
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const files=["package.json","package-lock.json","lib/version.ts","README.md","docs/IMPLEMENTATION_STATUS.md"];
  const [packageText,lockText,versionSource,readmeSource,statusSource]=await Promise.all(files.map(file=>readFile(new URL(`../${file}`,import.meta.url),"utf8")));
  console.log(`Release metadata aligned: v${checkReleaseMetadata({packageText,lockText,versionSource,readmeSource,statusSource})}`);
}
