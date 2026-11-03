import "server-only";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { hmac } from "@/lib/security/tokens";
import type { StorageDriver } from "./types";

/** Filesystem driver for local development. Files are served only through signed URLs. */
export class LocalStorageDriver implements StorageDriver {
  private root: string;
  constructor(dir: string, private secret: string) {
    this.root = path.resolve(process.cwd(), dir);
  }

  resolve(p: string): string {
    const full = path.resolve(this.root, p);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Invalid storage path");
    return full;
  }

  async put(p: string, data: Uint8Array) {
    const full = this.resolve(p);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async putFile(p: string, localFile: string) {
    const full = this.resolve(p);
    await mkdir(path.dirname(full), { recursive: true });
    await copyFile(localFile, full);
  }

  async get(p: string) {
    return new Uint8Array(await readFile(this.resolve(p)));
  }

  async exists(p: string) {
    try {
      await stat(this.resolve(p));
      return true;
    } catch {
      return false;
    }
  }

  async head(p: string) {
    try {
      return { size: (await stat(this.resolve(p))).size };
    } catch {
      return null;
    }
  }

  async list(prefix: string) {
    const dir = this.resolve(prefix.endsWith("/") ? prefix.slice(0, -1) : prefix);
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries.filter((e) => e.isFile()).map((e) => path.posix.join(prefix, e.name)).sort();
    } catch {
      return [];
    }
  }

  async listDetailed(prefix: string) {
    const files = await this.list(prefix);
    return Promise.all(files.map(async (f) => ({ path: f, size: (await stat(this.resolve(f))).size })));
  }

  async delete(p: string) {
    await rm(this.resolve(p), { force: true });
  }

  async deletePrefix(prefix: string) {
    await rm(this.resolve(prefix.endsWith("/") ? prefix.slice(0, -1) : prefix), { recursive: true, force: true });
  }

  async signedUrl(p: string, ttlSeconds: number, contentType = "application/octet-stream") {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const encoded = Buffer.from(p).toString("base64url");
    const sig = hmac(this.secret, `${encoded}.${exp}.${contentType}`);
    const params = new URLSearchParams({ p: encoded, e: String(exp), t: contentType, s: sig });
    return `/api/storage/object?${params.toString()}`;
  }

  verify(encoded: string, exp: string, contentType: string, sig: string): string | null {
    if (Number(exp) < Date.now() / 1000) return null;
    const expected = hmac(this.secret, `${encoded}.${exp}.${contentType}`);
    if (expected.length !== sig.length || expected !== sig) return null;
    return Buffer.from(encoded, "base64url").toString("utf8");
  }
}
