import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { decryptBackup, encryptBackup } from "./lib/backup-crypto.mjs";

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "lumina-backup-crypto-"));
const sourcePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(temporaryRoot, "fixture.bin");
const encryptedPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(temporaryRoot, "fixture.bin.enc");
const decryptedPath = process.argv[4]
  ? path.resolve(process.argv[4])
  : path.join(temporaryRoot, "fixture.decrypted.bin");

if (!process.argv[2]) await writeFile(sourcePath, randomBytes(128 * 1024));
const digest = (value) => createHash("sha256").update(value).digest("hex");

try {
  await encryptBackup(sourcePath, encryptedPath);
  await decryptBackup(encryptedPath, decryptedPath);
  const [source, decrypted] = await Promise.all([
    readFile(sourcePath),
    readFile(decryptedPath),
  ]);
  assert.equal(digest(decrypted), digest(source), "BACKUP_CRYPTO_ROUNDTRIP_MISMATCH");
  assert.notDeepEqual(
    (await readFile(encryptedPath)).subarray(0, Math.min(64, source.length)),
    source.subarray(0, Math.min(64, source.length)),
    "BACKUP_CIPHERTEXT_MATCHES_PLAINTEXT",
  );
  process.stdout.write(
    `[backup:crypto] AES-256-GCM round trip verified (${source.length} plaintext bytes).\n`,
  );
} finally {
  if (!process.argv[2]) await rm(temporaryRoot, { recursive: true, force: true });
}
