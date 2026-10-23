import {HOST_PATHS,HOST_COMPATIBILITY,MAINTENANCE_ASSETS,maintenanceBundle,sha256} from "../../deploy/libexec/lumina-host-contract.mjs";

export function inspectMaintenanceTrust(rootFile){
 const launcher=rootFile(HOST_PATHS.program),hash=sha256(launcher);
 for(const [sourceCommit,profile] of Object.entries(HOST_COMPATIBILITY.revisions))if(!profile.bundle&&profile.files["deploy/libexec/lumina-crm-storage-maintenance.mjs"]===hash)return{digest:hash,protocol:0,trust:"LEGACY_SUPPORTED",sourceCommit,builderImages:profile.maintenanceBuilderImages,capabilities:["trusted-code"]};
 const match=/^#!\/usr\/bin\/env node\nimport \{main\} from '\/usr\/local\/libexec\/lumina-crm-host\/([0-9a-f]{64})\/lumina-crm-storage-maintenance.mjs';\nawait main\(\);\n$/.exec(launcher);
 if(!match)throw new Error("MAINTENANCE_CODE_NOT_REVIEWED");
 const candidates=[MAINTENANCE_ASSETS,...Object.values(HOST_COMPATIBILITY.revisions).filter(value=>value.bundle).map(value=>value.bundle.paths)];
 for(const paths of candidates){try{
  const assets=Object.fromEntries(paths.map(file=>[file,rootFile(`${HOST_PATHS.bundles}/${match[1]}/${file.split("/").at(-1)}`)])),bundle=maintenanceBundle(assets,paths);
  if(bundle.digest!==match[1]||bundle.launcher!==launcher)continue;
  const receipt=JSON.parse(rootFile(`${HOST_PATHS.bundles}/installed.json`));
  if(receipt.schemaVersion!==1||receipt.stage!=="COMPLETE"||receipt.bundleDigest!==bundle.digest||receipt.launcherSha256!==bundle.launcherSha256)throw new Error("MAINTENANCE_INSTALL_INCOMPLETE");
  const known=Object.entries(HOST_COMPATIBILITY.revisions).find(([,value])=>value.bundle?.digest===bundle.digest);
  if(known)return{digest:bundle.digest,protocol:1,trust:"LEGACY_SUPPORTED",sourceCommit:known[0],builderImages:known[1].maintenanceBuilderImages,capabilities:["trusted-code"]};
  if(receipt.protocol!==1||!receipt.capabilities?.includes("trusted-code"))throw new Error("MAINTENANCE_PROTOCOL_UNVERIFIED");
  const contract=JSON.parse(assets["deploy/libexec/host-runtime-contract.json"]);
  return{digest:bundle.digest,protocol:1,trust:"OPERATOR_APPROVED",builderImages:contract.builder.supportedImages??[contract.builder.image],capabilities:receipt.capabilities};
 }catch{/* Try only the other fixed, audited bundle layouts. */}}
 throw new Error("MAINTENANCE_CODE_NOT_REVIEWED");
}
export function trustedUnit(unit,text,expected){return text===expected||Object.values(HOST_COMPATIBILITY.revisions).some(value=>value.unitHashes[unit]===sha256(text));}
