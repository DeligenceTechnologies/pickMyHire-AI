import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type z } from "zod";
import { AuthError } from "@/lib/auth/session";
import { AIError } from "@/lib/ai/openai-client";
import { log } from "@/lib/logger";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = "error", public issues?: { path: string; message: string }[]) {
    super(message);
  }
}

type Ctx<P> = { params: Promise<P> };

/** Same-origin check for state-changing requests (CSRF defence in depth on top of SameSite cookies). */
function assertSameOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError(403, "Invalid origin", "csrf");
  }
  if (originHost !== host) throw new ApiError(403, "Cross-origin request blocked", "csrf");
}

export function route<P = Record<string, string>>(
  fn: (req: NextRequest, params: P) => Promise<Response | unknown>,
  opts: { rateLimit?: { key: string; limit: number; windowMs: number } } = {},
) {
  return async (req: NextRequest, ctx: Ctx<P>): Promise<Response> => {
    try {
      assertSameOrigin(req);
      if (opts.rateLimit) {
        const r = rateLimit(`${opts.rateLimit.key}:${clientIp(req.headers)}`, opts.rateLimit.limit, opts.rateLimit.windowMs);
        if (!r.ok) {
          return NextResponse.json({ error: "Too many requests. Please wait a moment and try again." }, { status: 429, headers: { "Retry-After": String(r.retryAfterSec) } });
        }
      }
      const params = (await ctx.params) ?? ({} as P);
      const result = await fn(req, params);
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err, req);
    }
  };
}

export function errorResponse(err: unknown, req?: NextRequest): Response {
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: "Please check the highlighted fields.", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      { status: 400 },
    );
  }
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof ApiError) return NextResponse.json({ error: err.message, code: err.code, ...(err.issues ? { issues: err.issues } : {}) }, { status: err.status });
  if (err instanceof AIError) {
    log.warn("api.ai_error", { code: err.code, path: req?.nextUrl.pathname });
    const msg = err.code === "not_configured"
      ? "AI is not configured. Add OPENAI_API_KEY on the server."
      : "The AI service is temporarily unavailable. Your data is safe — please retry.";
    return NextResponse.json({ error: msg, code: `ai_${err.code}` }, { status: 502 });
  }
  log.error("api.unhandled_error", { path: req?.nextUrl.pathname, err: err instanceof Error ? err : String(err) });
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

export async function body<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
  return schema.parse(data);
}

export const uuidParam = (v: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) throw new ApiError(404, "Not found");
  return v;
};
