import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type ObjectBody = {
  body: Uint8Array;
  contentType: string;
  contentLength: number;
  checksum?: string;
};

export type ObjectMetadata = {
  contentType: string;
  checksum?: string;
};

export interface ObjectStore {
  put(key: string, body: Uint8Array, metadata: ObjectMetadata): Promise<void>;
  get(key: string): Promise<ObjectBody | null>;
  delete(key: string): Promise<void>;
  signDownload(key: string, expiresInSeconds: number): Promise<string>;
}

function validKey(key: string) {
  return /^(?:avatars|exports)\/[A-Za-z0-9][A-Za-z0-9._/-]{0,500}$/.test(key)
    && !key.includes("..")
    && !key.includes("//")
    && !key.includes("\\");
}

export function assertObjectKey(key: string) {
  if (!validKey(key)) throw new Error("INVALID_OBJECT_KEY");
  return key;
}

function signingSecret() {
  const secret = process.env.OBJECT_STORAGE_SIGNING_SECRET?.trim() ?? "";
  if (process.env.NODE_ENV === "production" && secret.length < 32) {
    throw new Error("OBJECT_STORAGE_SIGNING_SECRET_NOT_CONFIGURED");
  }
  return secret || "lumina-local-object-signing-secret-for-development";
}

function signedLocalUrl(key: string, expiresInSeconds: number) {
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const payload = Buffer.from(JSON.stringify({ key, expiresAt })).toString("base64url");
  const signature = createHmac("sha256", signingSecret()).update(payload).digest("base64url");
  return `/api/storage/object?token=${encodeURIComponent(`${payload}.${signature}`)}`;
}

export function verifyLocalObjectToken(token: string) {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", signingSecret()).update(payload).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(signature, "base64url"); } catch { return null; }
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      key?: string;
      expiresAt?: number;
    };
    if (
      typeof parsed.key !== "string"
      || !validKey(parsed.key)
      || !Number.isFinite(parsed.expiresAt)
      || Number(parsed.expiresAt) < Math.floor(Date.now() / 1000)
    ) return null;
    return parsed.key;
  } catch {
    return null;
  }
}

class LocalObjectStore implements ObjectStore {
  private root: string;

  constructor() {
    const configured = process.env.OBJECT_STORAGE_LOCAL_ROOT?.trim();
    this.root = path.resolve(configured || path.join(process.cwd(), "work", "object-storage"));
    if (process.env.NODE_ENV === "production") {
      if (!configured || !path.isAbsolute(configured)) {
        throw new Error("OBJECT_STORAGE_LOCAL_ROOT_MUST_BE_ABSOLUTE");
      }
      const relative = path.relative(process.cwd(), this.root);
      if (!relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("OBJECT_STORAGE_LOCAL_ROOT_MUST_BE_OUTSIDE_RELEASE");
      }
    }
  }

  private filePath(key: string) {
    assertObjectKey(key);
    const target = path.resolve(this.root, ...key.split("/"));
    const relative = path.relative(this.root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("INVALID_OBJECT_KEY");
    return target;
  }

  private metadataPath(key: string) {
    return `${this.filePath(key)}.metadata.json`;
  }

  async put(key: string, body: Uint8Array, metadata: ObjectMetadata) {
    const target = this.filePath(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body, { flag: "wx" }).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
      await writeFile(target, body);
    });
    await writeFile(this.metadataPath(key), JSON.stringify(metadata), "utf8");
  }

  async get(key: string) {
    try {
      const [body, metadataRaw] = await Promise.all([
        readFile(this.filePath(key)),
        readFile(this.metadataPath(key), "utf8"),
      ]);
      const metadata = JSON.parse(metadataRaw) as ObjectMetadata;
      return {
        body,
        contentType: metadata.contentType || "application/octet-stream",
        contentLength: body.byteLength,
        checksum: metadata.checksum,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string) {
    await Promise.all([
      rm(this.filePath(key), { force: true }),
      rm(this.metadataPath(key), { force: true }),
    ]);
  }

  async signDownload(key: string, expiresInSeconds: number) {
    assertObjectKey(key);
    return signedLocalUrl(key, expiresInSeconds);
  }
}

class S3ObjectStore implements ObjectStore {
  private client: S3Client;
  private bucket: string;

  constructor() {
    const endpoint = process.env.S3_ENDPOINT?.trim();
    const region = process.env.S3_REGION?.trim();
    const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
    this.bucket = process.env.S3_BUCKET?.trim() ?? "";
    if (!endpoint || !region || !accessKeyId || !secretAccessKey || !this.bucket) {
      throw new Error("S3_STORAGE_NOT_CONFIGURED");
    }
    this.client = new S3Client({
      endpoint,
      region,
      forcePathStyle: /^(1|true|yes|on)$/i.test(process.env.S3_FORCE_PATH_STYLE ?? ""),
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async put(key: string, body: Uint8Array, metadata: ObjectMetadata) {
    assertObjectKey(key);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: metadata.contentType,
      ChecksumSHA256: metadata.checksum
        ? Buffer.from(metadata.checksum, "hex").toString("base64")
        : undefined,
    }));
  }

  async get(key: string) {
    assertObjectKey(key);
    try {
      const response = await this.client.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }));
      if (!response.Body) return null;
      const body = await response.Body.transformToByteArray();
      return {
        body,
        contentType: response.ContentType ?? "application/octet-stream",
        contentLength: response.ContentLength ?? body.byteLength,
        checksum: response.ChecksumSHA256,
      };
    } catch (error) {
      if ((error as { name?: string }).name === "NoSuchKey") return null;
      throw error;
    }
  }

  async delete(key: string) {
    assertObjectKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async signDownload(key: string, expiresInSeconds: number) {
    assertObjectKey(key);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
}

let cachedStore: ObjectStore | undefined;

export function objectStore() {
  if (cachedStore) return cachedStore;
  cachedStore = (process.env.OBJECT_STORAGE_PROVIDER ?? "local").toLowerCase() === "s3"
    ? new S3ObjectStore()
    : new LocalObjectStore();
  return cachedStore;
}
