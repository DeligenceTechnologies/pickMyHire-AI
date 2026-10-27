import { ApiError, route } from "@/lib/api";
import { ApplyInputSchema, submitApplication } from "@/lib/services/applications";
import { RESUME_MAX_BYTES } from "@/lib/services/document-text";

/** Public job application (multipart form). Rate-limited; honeypot field "website" traps bots. */
export const POST = route<{ slug: string }>(async (req, { slug }) => {
  if (Number(req.headers.get("content-length") ?? 0) > RESUME_MAX_BYTES + 256 * 1024) throw new ApiError(413, "Resume files must be 10 MB or smaller.");
  const form = await req.formData();
  if (String(form.get("website") ?? "")) return { ok: true }; // bot: pretend success, store nothing
  const input = ApplyInputSchema.parse({
    name: form.get("name") ?? "",
    email: form.get("email") ?? "",
    phone: form.get("phone") ?? undefined,
    linkedin_url: form.get("linkedin_url") ?? undefined,
    cover_note: form.get("cover_note") ?? undefined,
    consent: form.get("consent") === "true",
  });
  const file = form.get("resume");
  if (!(file instanceof File) || file.size === 0) throw new ApiError(400, "Please attach your resume.");
  let answers: unknown = {};
  try {
    answers = JSON.parse(String(form.get("answers") ?? "{}"));
  } catch {
    throw new ApiError(400, "Invalid answers.");
  }
  await submitApplication(slug, input, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, answers);
  return { ok: true };
}, { rateLimit: { key: "public-apply", limit: 8, windowMs: 60 * 60_000 } });
