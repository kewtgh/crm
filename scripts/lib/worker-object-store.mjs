import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

function objectKey(key) {
  if (
    !/^(?:avatars|exports)\/[A-Za-z0-9][A-Za-z0-9._/-]{0,500}$/.test(key)
    || key.includes("..")
    || key.includes("//")
    || key.includes("\\")
  ) throw new Error("INVALID_OBJECT_KEY");
  return key;
}

function localStore() {
  const configured = process.env.OBJECT_STORAGE_LOCAL_ROOT?.trim();
  if (!configured || !path.isAbsolute(configured)) {
    throw new Error("OBJECT_STORAGE_LOCAL_ROOT_MUST_BE_ABSOLUTE");
  }
  const root = path.resolve(configured);
  const filePath = (key) => {
    const target = path.resolve(root, ...objectKey(key).split("/"));
    const relative = path.relative(root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("INVALID_OBJECT_KEY");
    return target;
  };
  return {
    async put(key, body, metadata) {
      const target = filePath(key);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, body);
      await writeFile(`${target}.metadata.json`, JSON.stringify(metadata), "utf8");
    },
    async delete(key) {
      const target = filePath(key);
      await Promise.all([rm(target, { force: true }), rm(`${target}.metadata.json`, { force: true })]);
    },
  };
}

function s3Store() {
  const endpoint = process.env.S3_ENDPOINT?.trim();
  const region = process.env.S3_REGION?.trim();
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("S3_STORAGE_NOT_CONFIGURED");
  }
  const client = new S3Client({
    endpoint,
    region,
    forcePathStyle: /^(1|true|yes|on)$/i.test(process.env.S3_FORCE_PATH_STYLE ?? ""),
    credentials: { accessKeyId, secretAccessKey },
  });
  return {
    async put(key, body, metadata) {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey(key),
        Body: body,
        ContentType: metadata.contentType,
        ChecksumSHA256: metadata.checksum
          ? Buffer.from(metadata.checksum, "hex").toString("base64")
          : undefined,
      }));
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey(key) }));
    },
  };
}

let store;
export function workerObjectStore() {
  store ??= (process.env.OBJECT_STORAGE_PROVIDER ?? "local").toLowerCase() === "s3"
    ? s3Store()
    : localStore();
  return store;
}
