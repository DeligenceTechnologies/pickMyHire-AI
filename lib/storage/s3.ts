import "server-only";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ObjectTooLargeError, type StorageDriver } from "./types";

export type S3DriverConfig = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  forcePathStyle?: boolean;
};

const DELETE_BATCH = 1000;

/** S3-compatible object storage: Cloudflare R2, AWS S3, MinIO, Supabase's S3 endpoint. */
export class S3StorageDriver implements StorageDriver {
  private client: S3Client;
  private bucket: string;

  constructor(cfg: S3DriverConfig) {
    this.bucket = cfg.bucket;
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      // Only checksum when the API requires it: R2 and other S3-compatible stores reject some defaults.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  /** R2 exposes the S3 API at a per-account endpoint; its region is always "auto". */
  static r2(cfg: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string }) {
    return new S3StorageDriver({
      bucket: cfg.bucket,
      region: "auto",
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    });
  }

  async put(p: string, data: Uint8Array, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: p, Body: data, ContentType: contentType }));
  }

  /** Multipart upload streamed from disk: 8 MB parts, 4 in flight. */
  async putFile(p: string, localFile: string, contentType: string) {
    const { size } = await stat(localFile);
    try {
      await new Upload({
        client: this.client,
        params: { Bucket: this.bucket, Key: p, Body: createReadStream(localFile), ContentType: contentType, ContentLength: size },
        partSize: 8 * 1024 * 1024,
        queueSize: 4,
        leavePartsOnError: false,
      }).done();
    } catch (err) {
      if (err instanceof S3ServiceException && (err.$metadata.httpStatusCode === 413 || err.name === "EntityTooLarge")) {
        throw new ObjectTooLargeError(size, err.message);
      }
      throw err;
    }
  }

  async get(p: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: p }));
    if (!res.Body) throw new Error("Storage download returned no body");
    return res.Body.transformToByteArray();
  }

  async exists(p: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: p }));
      return true;
    } catch (err) {
      if (err instanceof S3ServiceException && (err.$metadata.httpStatusCode === 404 || err.name === "NotFound")) return false;
      throw err;
    }
  }

  /** Every object under the prefix, recursively (S3 has no real folders), sorted by key. */
  private async listAll(prefix: string) {
    const out: { path: string; size: number }[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of res.Contents ?? []) if (o.Key) out.push({ path: o.Key, size: o.Size ?? 0 });
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  async list(prefix: string) {
    return (await this.listDetailed(prefix)).map((f) => f.path);
  }

  /** Direct children only, matching the other drivers. */
  async listDetailed(prefix: string) {
    const dir = prefix.endsWith("/") ? prefix : `${prefix}/`;
    return (await this.listAll(dir)).filter((o) => !o.path.slice(dir.length).includes("/"));
  }

  async delete(p: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: p }));
  }

  async deletePrefix(prefix: string) {
    const dir = prefix.endsWith("/") ? prefix : `${prefix}/`;
    const keys = (await this.listAll(dir)).map((o) => o.path);
    for (let i = 0; i < keys.length; i += DELETE_BATCH) {
      const res = await this.client.send(new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Objects: keys.slice(i, i + DELETE_BATCH).map((Key) => ({ Key })), Quiet: true },
      }));
      if (res.Errors?.length) throw new Error(`Storage delete failed for ${res.Errors.length} object(s): ${res.Errors[0].Message ?? res.Errors[0].Code}`);
    }
  }

  async signedUrl(p: string, ttlSeconds: number, contentType?: string) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: p, ResponseContentType: contentType }),
      { expiresIn: Math.min(ttlSeconds, 7 * 24 * 3600) },
    );
  }
}
