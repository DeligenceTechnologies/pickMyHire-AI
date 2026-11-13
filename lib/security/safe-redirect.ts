/**
 * A "?next=" path that is safe to redirect to, or null.
 * Only same-site paths: browsers read "/\evil.com" (and tabs or newlines inside it) as
 * "//evil.com", so anything that doesn't resolve to our own origin is rejected.
 */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || /[\\\s]/.test(next.slice(0, 2)) || next.startsWith("//")) return null;
  try {
    const base = "https://app.invalid";
    const url = new URL(next, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}
