export interface StorageDriver {
  put(path: string, data: Uint8Array, contentType: string): Promise<void>;
  /** Upload a local file without loading it into memory (multipart where the provider supports it). */
  putFile(path: string, localFile: string, contentType: string): Promise<void>;
  get(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
  /** Size of a stored object (null if the provider doesn't say), or null if it doesn't exist. */
  head(path: string): Promise<{ size: number | null } | null>;
  list(prefix: string): Promise<string[]>;
  /** Objects under a prefix with their sizes in bytes, sorted by path. */
  listDetailed(prefix: string): Promise<{ path: string; size: number }[]>;
  delete(path: string): Promise<void>;
  /** Delete every object under a prefix, including nested "folders". */
  deletePrefix(prefix: string): Promise<void>;
  /** Short-lived URL that grants read access to one object. */
  signedUrl(path: string, ttlSeconds: number, contentType?: string): Promise<string>;
}

/** The provider refused the object because it exceeds its size limit (retrying won't help). */
export class ObjectTooLargeError extends Error {
  constructor(public readonly bytes: number, detail: string) {
    super(`Storage rejected a ${Math.round(bytes / 1048576)} MB object as too large: ${detail}`);
    this.name = "ObjectTooLargeError";
  }
}
