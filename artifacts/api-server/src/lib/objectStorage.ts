/**
 * Cloudflare R2 object storage (S3-compatible). Replaces the Replit GCS sidecar.
 *
 * Env vars:
 *   R2_ACCOUNT_ID       - Cloudflare account ID
 *   R2_ACCESS_KEY_ID    - R2 access key
 *   R2_SECRET_ACCESS_KEY - R2 secret key
 *   R2_BUCKET_NAME      - bucket name (e.g. "sales-visit-log")
 *   R2_PUBLIC_BASE_URL  - optional: public URL prefix for public objects
 *
 * Objects are stored under `uploads/{uuid}` inside the bucket. Presigned URLs
 * are used for direct PUT from clients. Serving is proxied through Express
 * (GET /api/storage/objects/*) so no public bucket exposure is required.
 */
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import { createReadStream } from "fs";
import { mkdir, readFile as readFileFs, stat as statFs, writeFile as writeFileFs } from "fs/promises";
import { dirname, join } from "path";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// R2 client
// ---------------------------------------------------------------------------

function requiredEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} is required for R2 storage`);
  return v;
}

function getBucketName(): string {
  return requiredEnv("R2_BUCKET_NAME");
}

function hasR2Config(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME,
  );
}

function createR2Client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${requiredEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
}

let cachedClient: S3Client | null = null;
function client(): S3Client {
  if (!cachedClient) cachedClient = createR2Client();
  return cachedClient;
}

const LOCAL_STORAGE_ROOT = process.env.LOCAL_STORAGE_ROOT || "/root/projects/sales-visit-log/.local-object-storage";

function localDataPathForKey(key: string): string {
  return join(LOCAL_STORAGE_ROOT, key);
}

function localMetaPathForKey(key: string): string {
  return `${localDataPathForKey(key)}.meta.json`;
}

async function readLocalMeta(key: string): Promise<{ contentType?: string; metadata?: Record<string, string> }> {
  try {
    return JSON.parse(await readFileFs(localMetaPathForKey(key), "utf8"));
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Storage file handle (replaces GCS File)
// ---------------------------------------------------------------------------

export interface StorageFile {
  bucket: string;
  key: string;
  getMetadata(): Promise<{ contentType?: string; size?: number; metadata?: Record<string, string> }>;
  getReadStream(): Promise<Readable>;
  setMetadata(meta: { contentType?: string; metadata?: Record<string, string> }): Promise<void>;
}

class R2StorageFile implements StorageFile {
  constructor(
    public bucket: string,
    public key: string,
  ) {}

  async getMetadata() {
    const cmd = new HeadObjectCommand({ Bucket: this.bucket, Key: this.key });
    const resp = await client().send(cmd);
    return {
      contentType: resp.ContentType,
      size: resp.ContentLength,
      metadata: resp.Metadata,
    };
  }

  async getReadStream(): Promise<Readable> {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: this.key });
    const resp = await client().send(cmd);
    if (!resp.Body) throw new Error("Empty response body from R2");
    return resp.Body as Readable;
  }

  async setMetadata(meta: { contentType?: string; metadata?: Record<string, string> }) {
    // R2/S3 doesn't support updating metadata on existing objects without a copy.
    // For the ACL use case, we do a server-side copy-into-self with new metadata.
    const copySource = `${this.bucket}/${this.key}`;
    const { CopyObjectCommand } = await import("@aws-sdk/client-s3");
    const cmd = new CopyObjectCommand({
      Bucket: this.bucket,
      Key: this.key,
      CopySource: copySource,
      Metadata: meta.metadata,
      MetadataDirective: "REPLACE",
      ContentType: meta.contentType,
    });
    await client().send(cmd);
  }
}

class LocalStorageFile implements StorageFile {
  constructor(
    public bucket: string,
    public key: string,
  ) {}

  async getMetadata() {
    const [info, parsed] = await Promise.all([
      statFs(localDataPathForKey(this.key)),
      readLocalMeta(this.key),
    ]);
    return {
      contentType: parsed.contentType,
      size: info.size,
      metadata: parsed.metadata,
    };
  }

  async getReadStream(): Promise<Readable> {
    await statFs(localDataPathForKey(this.key));
    return createReadStream(localDataPathForKey(this.key));
  }

  async setMetadata(meta: { contentType?: string; metadata?: Record<string, string> }) {
    const metaPath = localMetaPathForKey(this.key);
    const existing = await readLocalMeta(this.key);
    await mkdir(dirname(metaPath), { recursive: true });
    await writeFileFs(metaPath, JSON.stringify({
      contentType: meta.contentType ?? existing.contentType,
      metadata: meta.metadata ?? existing.metadata ?? {},
    }));
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// ---------------------------------------------------------------------------
// ACL types (simplified - metadata-based, no GCS dependency)
// ---------------------------------------------------------------------------

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const UPLOADS_PREFIX = "uploads";
const PUBLIC_PREFIX = "public";

export class ObjectStorageService {
  private getPrivateObjectDir(): string {
    return UPLOADS_PREFIX;
  }

  /**
   * Generate a presigned PUT URL for a new upload. Client uploads directly to R2,
   * then we store the object path in the DB.
   */
  async getObjectEntityUploadURL(): Promise<string> {
    const objectId = randomUUID();
    const key = `${this.getPrivateObjectDir()}/${objectId}`;
    const bucket = getBucketName();

    const cmd = new PutObjectCommand({ Bucket: bucket, Key: key });
    return getSignedUrl(client(), cmd, { expiresIn: 900 });
  }

  async storeUploadedObject(
    buffer: Buffer,
    opts: { contentType?: string; metadata?: Record<string, string> } = {},
  ): Promise<string> {
    const objectId = randomUUID();
    const key = `${this.getPrivateObjectDir()}/${objectId}`;

    if (hasR2Config()) {
      const cmd = new PutObjectCommand({
        Bucket: getBucketName(),
        Key: key,
        Body: buffer,
        ContentType: opts.contentType,
        Metadata: opts.metadata,
      });
      await client().send(cmd);
      return `/objects/${key}`;
    }

    const dataPath = localDataPathForKey(key);
    await mkdir(dirname(dataPath), { recursive: true });
    await writeFileFs(dataPath, buffer);
    await writeFileFs(localMetaPathForKey(key), JSON.stringify({
      contentType: opts.contentType,
      metadata: opts.metadata ?? {},
    }));
    return `/objects/${key}`;
  }

  /**
   * Convert a presigned URL (or raw path) to the internal `/objects/{key}` path
   * stored in the database.
   */
  normalizeObjectEntityPath(rawPath: string): string {
    // Presigned URL: extract the path portion
    if (rawPath.startsWith("http")) {
      try {
        const url = new URL(rawPath);
        const parts = url.pathname.split("/");
        // /{bucket}/uploads/{uuid} -> /objects/uploads/{uuid}
        const uploadsIdx = parts.indexOf(UPLOADS_PREFIX);
        if (uploadsIdx >= 0) {
          const key = parts.slice(uploadsIdx).join("/");
          return `/objects/${key}`;
        }
        return rawPath;
      } catch {
        return rawPath;
      }
    }
    return rawPath;
  }

  /**
   * Get a StorageFile handle for an internal object path (`/objects/{key}`).
   */
  async getObjectEntityFile(objectPath: string): Promise<StorageFile> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const key = objectPath.slice("/objects/".length);
    if (!key) throw new ObjectNotFoundError();

    try {
      const localFile = new LocalStorageFile("local", key);
      await localFile.getMetadata();
      return localFile;
    } catch {
      // Fall through to R2.
    }

    if (hasR2Config()) {
      const file = new R2StorageFile(getBucketName(), key);
      try {
        await file.getMetadata();
        return file;
      } catch {
        throw new ObjectNotFoundError();
      }
    }

    throw new ObjectNotFoundError();
  }

  /**
   * Search for a public object by relative path. Returns null if not found.
   */
  async searchPublicObject(filePath: string): Promise<StorageFile | null> {
    const key = `${PUBLIC_PREFIX}/${filePath}`;
    try {
      const localFile = new LocalStorageFile("local", key);
      await localFile.getMetadata();
      return localFile;
    } catch {
      if (!hasR2Config()) return null;
    }

    const file = new R2StorageFile(getBucketName(), key);
    try {
      await file.getMetadata();
      return file;
    } catch {
      return null;
    }
  }

  /**
   * Download an object as a fetch-like Response for streaming to Express.
   */
  async downloadObject(file: StorageFile, cacheTtlSec = 3600): Promise<Response> {
    const meta = await file.getMetadata();
    const stream = await file.getReadStream();
    const webStream = Readable.toWeb(stream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": meta.contentType || "application/octet-stream",
      "Cache-Control": `private, max-age=${cacheTtlSec}`,
    };
    if (meta.size != null) {
      headers["Content-Length"] = String(meta.size);
    }

    return new Response(webStream, { headers });
  }

  // ── ACL helpers (simplified, unused in current routes) ──────────────────

  async trySetObjectEntityAclPolicy(
    _rawPath: string,
    _policy: ObjectAclPolicy,
  ): Promise<string> {
    // ACL is currently a no-op. The storage route has all ACL checks commented out.
    // When auth is added, persist the policy as object metadata here.
    return _rawPath;
  }

  async canAccessObjectEntity(_opts: {
    userId?: string;
    objectFile: StorageFile;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return true;
  }
}

/**
 * Download an object's bytes into a Buffer (used by the transcription pipeline).
 */
export async function downloadObjectBuffer(
  objectPath: string,
): Promise<Buffer> {
  const svc = new ObjectStorageService();
  const file = await svc.getObjectEntityFile(objectPath);
  const stream = await file.getReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
