import "server-only";
import { open, stat } from "node:fs/promises";
import { ObjectTooLargeError, type StorageDriver } from "./types";

/** Supabase requires every resumable (TUS) chunk except the last to be exactly 6 MB. */
const TUS_CHUNK_BYTES = 6 * 1024 * 1024;
const LIST_PAGE = 1000;
const DELETE_BATCH = 500;

type ListItem = { name: string; id: string | null; metadata?: { size?: number } | null };

/** Supabase Storage via its REST API using the service role key (server only). */
export class SupabaseStorageDriver implements StorageDriver {
  constructor(private url: string, private serviceKey: string, private bucket: string) {
    if (!url || !serviceKey) throw new Error("Supabase storage requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    this.url = url.replace(/\/$/, "");
  }

  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey, ...extra };
  }

  private obj(p: string) {
    return `${this.url}/storage/v1/object/${this.bucket}/${p.split("/").map(encodeURIComponent).join("/")}`;
  }

  /** Supabase reports size-limit failures as 413, or as 400 with a "413"/"too large" body. */
  private async uploadError(res: Response, bytes: number, what: string): Promise<Error> {
    const text = (await res.text().catch(() => "")).slice(0, 300);
    if (res.status === 413 || /413|too large|maximum allowed size/i.test(text)) return new ObjectTooLargeError(bytes, text || `HTTP ${res.status}`);
    return new Error(`${what} failed (${res.status}): ${text}`);
  }

  async put(p: string, data: Uint8Array, contentType: string) {
    const res = await fetch(this.obj(p), {
      method: "POST",
      headers: this.headers({ "Content-Type": contentType, "x-upsert": "true" }),
      body: Buffer.from(data),
    });
    if (!res.ok) throw await this.uploadError(res, data.byteLength, "Storage upload");
  }

  /** Small files go up in one request; larger ones use Supabase's resumable (TUS) endpoint in 6 MB parts. */
  async putFile(p: string, localFile: string, contentType: string) {
    const { size } = await stat(localFile);
    const fh = await open(localFile, "r");
    try {
      if (size <= TUS_CHUNK_BYTES) {
        const buf = Buffer.alloc(size);
        await fh.read(buf, 0, size, 0);
        return await this.put(p, buf, contentType);
      }
      const b64 = (s: string) => Buffer.from(s).toString("base64");
      const create = await fetch(`${this.url}/storage/v1/upload/resumable`, {
        method: "POST",
        headers: this.headers({
          "Tus-Resumable": "1.0.0",
          "Upload-Length": String(size),
          "Upload-Metadata": [`bucketName ${b64(this.bucket)}`, `objectName ${b64(p)}`, `contentType ${b64(contentType)}`, `cacheControl ${b64("3600")}`].join(","),
          "x-upsert": "true",
        }),
      });
      if (create.status !== 201) throw await this.uploadError(create, size, "Resumable upload start");
      const location = create.headers.get("location");
      if (!location) throw new Error("Resumable upload start returned no Location");
      const uploadUrl = new URL(location, this.url).toString();

      const buf = Buffer.alloc(TUS_CHUNK_BYTES);
      let offset = 0;
      while (offset < size) {
        const { bytesRead } = await fh.read(buf, 0, Math.min(TUS_CHUNK_BYTES, size - offset), offset);
        const res = await this.patchWithRetry(uploadUrl, offset, Buffer.from(buf.subarray(0, bytesRead)));
        if (!res.ok) throw await this.uploadError(res, size, `Resumable upload at byte ${offset}`);
        const next = Number(res.headers.get("upload-offset"));
        offset = Number.isFinite(next) && next > offset ? next : offset + bytesRead;
      }
    } finally {
      await fh.close();
    }
  }

  private async patchWithRetry(uploadUrl: string, offset: number, body: Buffer<ArrayBuffer>) {
    let last: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        last = await fetch(uploadUrl, {
          method: "PATCH",
          headers: this.headers({ "Tus-Resumable": "1.0.0", "Upload-Offset": String(offset), "Content-Type": "application/offset+octet-stream" }),
          body,
        });
        if (last.ok || last.status < 500) return last;
      } catch (err) {
        if (attempt === 2) throw err;
      }
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
    return last!;
  }

  async get(p: string) {
    const res = await fetch(this.obj(p), { headers: this.headers() });
    if (!res.ok) throw new Error(`Storage download failed (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async exists(p: string) {
    const res = await fetch(this.obj(p), { method: "HEAD", headers: this.headers() });
    return res.ok;
  }

  async head(p: string) {
    const res = await fetch(this.obj(p), { method: "HEAD", headers: this.headers() });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`Storage HEAD failed (${res.status})`);
    const len = Number(res.headers.get("content-length"));
    return { size: Number.isFinite(len) && len > 0 ? len : null };
  }

  private async listPage(prefix: string, offset: number): Promise<ListItem[] | null> {
    const res = await fetch(`${this.url}/storage/v1/object/list/${this.bucket}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ prefix, limit: LIST_PAGE, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (!res.ok) return null;
    return (await res.json()) as ListItem[];
  }

  /** Direct children of a "folder": files carry an id, sub-folders don't. */
  private async children(prefix: string) {
    const dir = prefix.replace(/\/$/, "");
    const files: { path: string; size: number }[] = [];
    const folders: string[] = [];
    for (let offset = 0; ; offset += LIST_PAGE) {
      const items = await this.listPage(dir, offset);
      if (!items) break;
      for (const i of items) {
        if (i.id) files.push({ path: `${dir}/${i.name}`, size: i.metadata?.size ?? 0 });
        else folders.push(`${dir}/${i.name}`);
      }
      if (items.length < LIST_PAGE) break;
    }
    return { files, folders };
  }

  async list(prefix: string) {
    return (await this.listDetailed(prefix)).map((f) => f.path);
  }

  async listDetailed(prefix: string) {
    return (await this.children(prefix)).files;
  }

  async delete(p: string) {
    await this.deleteMany([p]);
  }

  async deletePrefix(prefix: string) {
    const { files, folders } = await this.children(prefix);
    if (files.length) await this.deleteMany(files.map((f) => f.path));
    for (const folder of folders) await this.deletePrefix(folder);
  }

  private async deleteMany(paths: string[]) {
    for (let i = 0; i < paths.length; i += DELETE_BATCH) {
      const res = await fetch(`${this.url}/storage/v1/object/${this.bucket}`, {
        method: "DELETE",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ prefixes: paths.slice(i, i + DELETE_BATCH) }),
      });
      if (!res.ok) throw new Error(`Storage delete failed (${res.status})`);
    }
  }

  async signedUrl(p: string, ttlSeconds: number) {
    const res = await fetch(`${this.url}/storage/v1/object/sign/${this.bucket}/${p.split("/").map(encodeURIComponent).join("/")}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn: ttlSeconds }),
    });
    if (!res.ok) throw new Error(`Could not sign storage URL (${res.status})`);
    const { signedURL } = (await res.json()) as { signedURL: string };
    return `${this.url}/storage/v1${signedURL}`;
  }
}
