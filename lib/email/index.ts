import "server-only";
import { env } from "@/lib/env";
import { withSystem } from "@/lib/database/db";
import { log } from "@/lib/logger";
import { logoUrl } from "@/lib/branding";
import { renderEmailHtml, type EmailBrand, type EmailCta } from "./html";
import type { JobRequirements } from "@/lib/validation/ai-schemas";

export type EmailAttachment = { filename: string; content: string; contentType: string };
export type EmailMessage = {
  to: string; subject: string; text: string; orgId?: string | null;
  /** Where replies go (e.g. the recruiter), since the From address has no mailbox. */
  replyTo?: string | null;
  attachments?: EmailAttachment[];
  /** The main action, shown as a button in the HTML version. */
  cta?: EmailCta | null;
  /** Whose logo and colour to use; PickMyHire.ai when not given. */
  brand?: EmailBrand | null;
};

/** PickMyHire.ai's own look, for team, account and platform emails. */
export function platformBrand(): EmailBrand {
  return { name: "PickMyHire.ai", logoUrl: `${env().APP_URL}/brand/email-logo.png`, color: "#0b5bd3" };
}

/** A hiring company's logo and colour, for the emails its candidates receive. */
export async function companyBrand(orgId: string): Promise<EmailBrand> {
  try {
    const [o] = await withSystem((tx) => tx<{ name: string; logo_path: string | null; logo_updated_at: Date | null; brand_color: string | null }[]>`
      select name, logo_path, logo_updated_at, brand_color from organizations where id = ${orgId}`);
    if (!o) return platformBrand();
    const path = logoUrl(orgId, o.logo_updated_at, o.logo_path);
    return { name: o.name, logoUrl: path ? `${env().APP_URL}${path}` : null, color: o.brand_color, company: true };
  } catch {
    return platformBrand();
  }
}

interface EmailProvider {
  name: string;
  send(msg: EmailMessage): Promise<void>;
}

/** Development provider: records the message in email_outbox (visible under Settings → Notifications). */
const logProvider: EmailProvider = {
  name: "log",
  async send(msg) {
    log.info("email.logged", { to_domain: msg.to.split("@")[1], subject: msg.subject });
  },
};

/** The Resend API request body (attachments are sent base64-encoded). */
export function resendPayload(msg: EmailMessage, from: string | undefined) {
  return {
    from, to: msg.to, subject: msg.subject, text: msg.text,
    html: renderEmailHtml({ subject: msg.subject, text: msg.text, brand: msg.brand ?? platformBrand(), cta: msg.cta }),
    ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
    ...(msg.attachments?.length ? {
      attachments: msg.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString("base64"), content_type: a.contentType })),
    } : {}),
  };
}

const resendProvider: EmailProvider = {
  name: "resend",
  async send(msg) {
    const e = env();
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${e.EMAIL_PROVIDER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(resendPayload(msg, e.EMAIL_FROM)),
    });
    if (!res.ok) throw new Error(`Email provider returned ${res.status}`);
  },
};

/** `Name <email>` for a reply-to header (characters that would break the header are dropped). */
export const mailbox = (name: string, email: string) => `${name.replace(/[<>"\\,;]/g, "").trim() || email} <${email}>`;

/** Email every platform admin (best effort: the thing it's about is already saved). */
export async function emailPlatformAdmins(tpl: { subject: string; text: string; cta?: EmailCta }, replyTo?: string | null) {
  try {
    const admins = await withSystem((tx) => tx<{ email: string }[]>`select email from users where is_platform_admin and disabled_at is null`);
    for (const a of admins) await sendEmail({ to: a.email, ...tpl, replyTo });
  } catch (err) {
    log.warn("email.platform_admins_failed", { err });
  }
}

/** "Name <email>" for a team member, used as the reply-to on emails sent on their behalf. */
export async function replyToUser(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  try {
    const [u] = await withSystem((tx) => tx<{ name: string; email: string }[]>`select name, email from users where id = ${userId} and disabled_at is null`);
    return u ? mailbox(u.name, u.email) : null;
  } catch {
    return null;
  }
}

function provider(): EmailProvider {
  return env().EMAIL_PROVIDER === "resend" ? resendProvider : logProvider;
}

export async function sendEmail(msg: EmailMessage): Promise<{ ok: boolean }> {
  const p = provider();
  let status = "sent";
  let error: string | null = null;
  try {
    await p.send(msg);
  } catch (err) {
    status = "failed";
    error = err instanceof Error ? err.message : "send failed";
    log.warn("email.send_failed", { provider: p.name, error });
  }
  // The outbox notes the reply-to and attachments too, so they're visible under Settings → Notifications.
  const extras = [msg.replyTo && `Reply-to: ${msg.replyTo}`, ...(msg.attachments ?? []).map((a) => `Attached: ${a.filename}`)].filter(Boolean);
  const logged = extras.length ? `${msg.text}\n\n---\n${extras.join("\n")}` : msg.text;
  await withSystem((tx) => tx`
    insert into email_outbox (organization_id, to_email, subject, body_text, provider, status, error)
    values (${msg.orgId ?? null}, ${msg.to}, ${msg.subject}, ${logged}, ${p.name}, ${status}, ${error})`);
  return { ok: status === "sent" };
}

/**
 * "About the role" for interview emails: the summary, main responsibilities and required
 * skills the AI extracted when the job was created (never the full description).
 * Empty when the job hasn't been analysed.
 */
export function aboutRole(req: JobRequirements | null | undefined): string {
  const summary = req?.summary?.trim();
  if (!req || !summary) return "";
  const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
  const duties = req.responsibilities.map((r) => clip(r.trim(), 200)).filter(Boolean).slice(0, 4);
  const skills = req.skills.filter((s) => s.importance === "required").map((s) => s.name.trim()).filter(Boolean).slice(0, 8);
  return [
    `About the role\n${summary}`,
    duties.length ? `What you'll do:\n\n${duties.map((d) => `• ${d}`).join("\n")}` : "",
    skills.length ? `Key skills: ${skills.join(", ")}` : "",
  ].filter(Boolean).join("\n\n");
}

export const emailTemplates = {
  invitation(input: { candidateName: string; jobTitle: string; companyName: string; minutes: number; link: string; expiresAt: Date | null; roundName?: string | null; role?: JobRequirements | null }) {
    const role = aboutRole(input.role);
    return {
      subject: input.roundName ? `Your ${input.roundName} interview for ${input.jobTitle}` : "Your AI interview invitation",
      cta: { label: "Start your interview", url: input.link },
      text: `Hi ${input.candidateName},

${input.companyName} has invited you to ${input.roundName ? `the ${input.roundName} round, an AI-assisted interview,` : "an AI-assisted interview"} for the ${input.jobTitle} role.
${role ? `\n${role}\n` : ""}
• Approximate duration: ${input.minutes} minutes
• You'll need a computer with a camera and microphone, and a quiet place.
• The interview is recorded and transcribed. You'll be asked for consent before it starts.
${input.expiresAt ? `• This link expires on ${input.expiresAt.toUTCString()}.\n` : ""}
Start your interview: ${input.link}

This link is personal to you — please don't share it. Questions? Just reply to this email.

${input.companyName} hiring team`,
    };
  },
  applicationReceived(input: { candidateName: string; jobTitle: string; companyName: string }) {
    return {
      subject: `We received your application — ${input.jobTitle}`,
      text: `Hi ${input.candidateName},

Thank you for applying for the ${input.jobTitle} role at ${input.companyName}. We've received your application and resume.

Our hiring team reviews every application. If your background is a match, we'll email you an invitation to the next step. Questions? Just reply to this email.

${input.companyName} hiring team`,
    };
  },
  reminder(input: { candidateName: string; jobTitle: string; companyName: string; link: string; roundName?: string | null; role?: JobRequirements | null }) {
    const role = aboutRole(input.role);
    return {
      subject: `Reminder: your ${input.roundName ? `${input.roundName} ` : ""}interview for ${input.jobTitle}`,
      cta: { label: "Start your interview", url: input.link },
      text: `Hi ${input.candidateName},

This is a friendly reminder that your ${input.roundName ? `${input.roundName} ` : ""}AI interview for the ${input.jobTitle} role at ${input.companyName} is still waiting for you.
${role ? `\n${role}\n` : ""}
Start when you're ready: ${input.link}

Questions? Just reply to this email.

${input.companyName} hiring team`,
    };
  },
  /** To the candidate once their interview is processed: a confirmation, with AI feedback when there is any. */
  candidateThankYou(input: { candidateName: string; jobTitle: string; companyName: string; roundName?: string | null; feedback: string | null }) {
    const what = `${input.roundName ? `${input.roundName} ` : ""}interview for the ${input.jobTitle} role`;
    return {
      subject: `Thank you for your interview: ${input.jobTitle}`,
      text: `Hi ${input.candidateName},

Thank you for taking your ${what} at ${input.companyName}. We've received your interview, and the hiring team will review it and be in touch about next steps.
${input.feedback ? `
Feedback on your interview

${input.feedback}

This feedback was generated by AI from your interview answers. It is not a hiring decision: the ${input.companyName} hiring team reviews every interview.
` : ""}
Questions? Just reply to this email.

${input.companyName} hiring team`,
    };
  },
  completed(input: { candidateName: string; jobTitle: string; link: string }) {
    return {
      subject: `${input.candidateName} completed their interview`,
      cta: { label: "View the interview", url: input.link },
      text: `${input.candidateName} has completed the AI interview for ${input.jobTitle}.\n\nThe report will be ready shortly: ${input.link}`,
    };
  },
  teamInvite(input: { orgName: string; inviter: string; role: string; link: string }) {
    return {
      subject: `You've been invited to ${input.orgName}`,
      cta: { label: "Accept invitation", url: input.link },
      text: `${input.inviter} invited you to join ${input.orgName} as ${input.role}.\n\nAccept the invitation: ${input.link}\n\nThis link expires in 7 days.`,
    };
  },
  humanInterview(input: {
    kind: "invite" | "rescheduled" | "cancelled"; name: string; jobTitle: string; companyName: string; roundName: string;
    when: string; where: string; with: string; message: string | null; reason: string | null; link?: string; team?: boolean;
  }) {
    const what = input.team ? `${input.roundName} interview with ${input.with} (${input.jobTitle})` : `${input.roundName} interview for ${input.jobTitle} at ${input.companyName}`;
    const subject = input.kind === "cancelled" ? `Cancelled: ${what}` : input.kind === "rescheduled" ? `New time: ${what}` : input.team ? `You're interviewing: ${what}` : `Interview invitation: ${what}`;
    const lead = input.kind === "cancelled" ? `The ${what} has been cancelled.${input.reason ? `\nReason: ${input.reason}` : ""}`
      : input.kind === "rescheduled" ? `The ${what} has moved to a new time.${input.reason ? `\nReason: ${input.reason}` : ""}`
      : input.team ? `You're on the panel for the ${what}.` : `${input.companyName} would like to invite you to the ${input.roundName} interview for the ${input.jobTitle} role.`;
    const details = input.kind === "cancelled" ? "" : `\n\nWhen: ${input.when}\nWhere: ${input.where}\nWith: ${input.with}${input.message ? `\n\n${input.message}` : ""}`;
    const calendar = input.kind === "cancelled" ? "\n\nThe attached calendar update removes it from your calendar." : "\n\nOpen the attached invite (invite.ics) to add it to your calendar.";
    const tail = input.team && input.link ? `\n\nInterview guide and scorecard: ${input.link}` : input.kind === "cancelled" ? "" : "\n\nIf this time doesn't work for you, please reply to let us know.";
    const meeting = input.kind === "cancelled" ? null : /https?:\/\/\S+/.exec(input.where)?.[0];
    const cta = input.team && input.link ? { label: "Open interview guide", url: input.link } : meeting ? { label: "Join the meeting", url: meeting } : null;
    return { subject, text: `Hi ${input.name},\n\n${lead}${details}${calendar}${tail}\n\n${input.companyName}`, cta };
  },
  supportToAdmin(input: { kind: "new" | "reply"; company: string; name: string; email: string; category?: string; subject: string; message: string; link: string }) {
    return {
      subject: input.kind === "new" ? `Support: ${input.subject} (${input.company})` : `Re: ${input.subject} (${input.company})`,
      cta: { label: "Open in admin", url: input.link },
      text: `${input.kind === "new" ? `New support request${input.category ? ` (${input.category})` : ""}` : "New reply on a support request"} from ${input.name} <${input.email}>, ${input.company}.

${input.message}

Open in admin: ${input.link}`,
    };
  },
  inquiryToAdmin(input: { topic: string; name: string; email: string; company: string | null; phone: string | null; teamSize: string | null; message: string | null; link: string }) {
    const details = [
      `From: ${input.name} <${input.email}>`,
      input.company && `Company: ${input.company}`,
      input.phone && `Phone: ${input.phone}`,
      input.teamSize && `Team size: ${input.teamSize} employees`,
    ].filter(Boolean).join("\n");
    return {
      subject: `New inquiry: ${input.topic}${input.company ? ` (${input.company})` : ` from ${input.name}`}`,
      cta: { label: "Open in admin", url: input.link },
      text: `${details}${input.message ? `\n\n${input.message}` : ""}\n\nReply to this email to answer ${input.name} directly, or open it in admin: ${input.link}`,
    };
  },
  trialToAdmin(input: { company: string; name: string; email: string; interviews: number; days: number; link: string }) {
    return {
      subject: `New free trial: ${input.company}`,
      cta: { label: "Open company", url: input.link },
      text: `${input.name} <${input.email}> started a free trial for ${input.company} (${input.interviews} interviews for ${input.days} days).\n\nReply to this email to reach them directly, or open the company in admin: ${input.link}`,
    };
  },
  supportReply(input: { name: string; subject: string; message: string; link: string }) {
    return {
      subject: `Re: ${input.subject}`,
      cta: { label: "View conversation", url: input.link },
      text: `Hi ${input.name},

PickMyHire.ai support replied to your request "${input.subject}":

${input.message}

View the conversation or reply: ${input.link}

PickMyHire.ai support`,
    };
  },
  verifyEmail(input: { name: string; link: string }) {
    return {
      subject: "Confirm your email to start your PickMyHire.ai trial",
      cta: { label: "Confirm my email", url: input.link },
      text: `Hi ${input.name},\n\nConfirm your email to start inviting candidates to AI interviews (link valid for 3 days):\n${input.link}\n\nIf you didn't sign up for PickMyHire.ai, you can ignore this email.`,
    };
  },
  passwordReset(input: { link: string }) {
    return {
      subject: "Reset your password",
      cta: { label: "Reset password", url: input.link },
      text: `We received a request to reset your password.\n\nReset it here (valid for 1 hour): ${input.link}\n\nIf you didn't request this, you can ignore this email.`,
    };
  },
};
