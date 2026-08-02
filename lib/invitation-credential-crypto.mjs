import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey(environment = process.env) {
  const configured = environment.INVITATION_CREDENTIAL_ENCRYPTION_KEY?.trim() ?? "";
  const key = /^[a-f0-9]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (key.length !== 32) throw new Error("INVITATION_CREDENTIAL_ENCRYPTION_KEY_NOT_CONFIGURED");
  return key;
}

export function encryptInvitationCredential(value, environment = process.env) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(environment), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return {
    version: 1,
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptInvitationCredential(value, environment = process.env) {
  if (!value || value.version !== 1) throw new Error("INVALID_INVITATION_CREDENTIAL");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(environment),
    Buffer.from(value.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
