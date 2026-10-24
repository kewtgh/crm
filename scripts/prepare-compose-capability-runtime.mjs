import {createHash} from "node:crypto";
import {existsSync,readFileSync,mkdirSync,writeFileSync,renameSync,chmodSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

// Official v2.40.3 release checksums. Test-only tooling: never installed system-wide.
export const COMPOSE_CAPABILITY_RELEASE=Object.freeze({
 version:"2.40.3",
 "win32-x64":{file:"docker-compose-windows-x86_64.exe",sha256:"4c864dd7f879dd40366e087e68a8a02cbcf018be0128867b13369898e67e1532"},
 "linux-x64":{file:"docker-compose-linux-x86_64",sha256:"dba9d98e1ba5bfe11d88c99b9bd32fc4a0624a30fafe68eea34d61a3e42fd372"},
});
const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
export async function prepareComposeCapabilityRuntime(){
 if(process.env.LUMINA_COMPOSE_2403_PATH){
  const binary=path.resolve(process.env.LUMINA_COMPOSE_2403_PATH);if(!existsSync(binary))throw new Error("COMPOSE_CAPABILITY_BINARY_MISSING");
  return binary; // An explicitly supplied distribution build is version-checked by integration.
 }
 const release=COMPOSE_CAPABILITY_RELEASE[`${process.platform}-${process.arch}`];if(!release)throw new Error("COMPOSE_CAPABILITY_TEST_PLATFORM_UNSUPPORTED");
 const directory=path.join(sourceRoot,"work/compose-security-runtime"),binary=path.join(directory,release.file);
 if(!existsSync(binary)){
  mkdirSync(directory,{recursive:true,mode:0o700});
  const response=await fetch(`https://github.com/docker/compose/releases/download/v2.40.3/${release.file}`,{signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw new Error("COMPOSE_CAPABILITY_DOWNLOAD_FAILED");
  const bytes=Buffer.from(await response.arrayBuffer());if(createHash("sha256").update(bytes).digest("hex")!==release.sha256)throw new Error("COMPOSE_CAPABILITY_CHECKSUM_MISMATCH");
  const temporary=`${binary}.pending-${process.pid}`;writeFileSync(temporary,bytes,{flag:"wx",mode:0o700});renameSync(temporary,binary);
 }
 if(createHash("sha256").update(readFileSync(binary)).digest("hex")!==release.sha256)throw new Error("COMPOSE_CAPABILITY_CHECKSUM_MISMATCH");
 if(process.platform!=="win32")chmodSync(binary,0o700);
 return binary;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await prepareComposeCapabilityRuntime();console.log(`Verified Compose ${COMPOSE_CAPABILITY_RELEASE.version} integration runtime (${process.platform}/${process.arch})`);}
 catch{console.error("Compose 2.40.3 integration runtime unavailable. Prepare the checksum-verified work/ runtime or set LUMINA_COMPOSE_2403_PATH to a reviewed 2.40.3 distribution binary; no substitute version is accepted.");process.exitCode=1;}
}
