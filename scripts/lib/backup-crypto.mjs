import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import {
  appendFile,
  open,
  stat,
  writeFile,
} from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

const magic = Buffer.from("LUMINA_PG_BACKUP_V1\n", "ascii");
const ivLength = 12;
const tagLength = 16;

export function backupEncryptionKey(environment = process.env) {
  const configured = environment.BACKUP_ENCRYPTION_KEY?.trim() ?? "";
  const key = /^[a-f0-9]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (key.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY_NOT_CONFIGURED");
  return key;
}

export async function encryptBackup(inputPath, outputPath, key = backupEncryptionKey()) {
  const iv = randomBytes(ivLength);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  await writeFile(outputPath, Buffer.concat([magic, iv]), { flag: "wx", mode: 0o600 });
  await pipeline(
    createReadStream(inputPath),
    cipher,
    createWriteStream(outputPath, { flags: "a", mode: 0o600 }),
  );
  await appendFile(outputPath, cipher.getAuthTag());
}

export async function decryptBackup(inputPath, outputPath, key = backupEncryptionKey()) {
  const metadata = await stat(inputPath);
  const minimum = magic.length + ivLength + tagLength + 1;
  if (metadata.size < minimum) throw new Error("BACKUP_FILE_INVALID");
  const handle = await open(inputPath, "r");
  try {
    const prefix = Buffer.alloc(magic.length + ivLength);
    await handle.read(prefix, 0, prefix.length, 0);
    if (!prefix.subarray(0, magic.length).equals(magic)) throw new Error("BACKUP_FILE_INVALID");
    const tag = Buffer.alloc(tagLength);
    await handle.read(tag, 0, tag.length, metadata.size - tagLength);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      prefix.subarray(magic.length),
    );
    decipher.setAuthTag(tag);
    await pipeline(
      createReadStream(inputPath, {
        start: magic.length + ivLength,
        end: metadata.size - tagLength - 1,
      }),
      decipher,
      createWriteStream(outputPath, { flags: "wx", mode: 0o600 }),
    );
  } finally {
    await handle.close();
  }
}
