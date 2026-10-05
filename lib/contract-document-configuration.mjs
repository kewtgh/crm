import {createCipheriv,createDecipheriv,randomBytes} from "node:crypto";
// Same established AES-256-GCM pattern as invitation credentials, with a separate key/AAD.
function key(environment) {
  const raw=environment.DOCUMENT_CONFIGURATION_ENCRYPTION_KEY?.trim()??"";
  const value=/^[a-f0-9]{64}$/i.test(raw)?Buffer.from(raw,"hex"):Buffer.from(raw,"base64");
  if(value.length!==32)throw new Error("DOCUMENT_CONFIGURATION_ENCRYPTION_KEY_NOT_CONFIGURED");
  return value;
}
export function sealDocumentConfiguration(values,environment=process.env) {
  if(!values||Array.isArray(values)||typeof values!=="object"||!Object.keys(values).length)throw new Error("DOCUMENT_CONFIGURATION_INVALID");
  for(const [name,value] of Object.entries(values))if(!/^(company|bank)\.[a-z_]+$/.test(name)||typeof value!=="string"||!value.trim()||value.length>5000||/\{\{|\}\}|[\u0000-\u001f]/.test(value))throw new Error("DOCUMENT_CONFIGURATION_INVALID");
  const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key(environment),iv);
  cipher.setAAD(Buffer.from("lumina-contract-document-configuration-v1"));
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(values),"utf8"),cipher.final()]);
  return {version:1,ciphertext:ciphertext.toString("base64"),iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64")};
}
export function openDocumentConfiguration(envelope,environment=process.env) {
  if(envelope?.version!==1)throw new Error("DOCUMENT_CONFIGURATION_INVALID");
  const decipher=createDecipheriv("aes-256-gcm",key(environment),Buffer.from(envelope.iv,"base64"));
  decipher.setAAD(Buffer.from("lumina-contract-document-configuration-v1"));decipher.setAuthTag(Buffer.from(envelope.tag,"base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,"base64")),decipher.final()]).toString("utf8"));
}
