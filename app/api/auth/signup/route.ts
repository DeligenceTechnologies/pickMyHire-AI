import { z } from "zod";
import { ApiError, body, route } from "@/lib/api";
import { withSystem } from "@/lib/database/db";
import { getSignupCode, getTrialSettings } from "@/lib/services/platform";
import { trialAlreadyUsed } from "@/lib/services/admin";
import { safeEqual } from "@/lib/security/tokens";
import { createSession } from "@/lib/auth/session";
import { sendEmailVerification, signup } from "@/lib/services/accounts";
import { emailDomain, isWorkEmail, WORK_EMAIL_MESSAGE } from "@/lib/validation/work-email";
import { runInBackground } from "@/lib/background";
import { emailPlatformAdmins, emailTemplates, mailbox } from "@/lib/email";
import { env } from "@/lib/env";

const Schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(10, "Use at least 10 characters").max(200),
  orgName: z.string().trim().max(100).optional(),
  inviteToken: z.string().max(200).optional(),
  accessCode: z.string().max(200).optional(),
  companyInvite: z.string().max(200).optional(),
  /** Self-serve free trial instead of an access code. */
  trial: z.boolean().optional(),
});

export const POST = route(async (req) => {
  const input = await body(req, Schema);
  let trial: { interviews: number; days: number; domain: string } | undefined;
  if (!input.inviteToken && !input.companyInvite) {
    if (input.trial) {
      const t = await getTrialSettings();
      if (!t.enabled) throw new ApiError(403, "Free trials are paused right now. Request access or book a demo and we'll set you up.");
      if (!isWorkEmail(input.email)) throw new ApiError(400, WORK_EMAIL_MESSAGE, "personal_email");
      if (!input.orgName) throw new ApiError(400, "Enter your company name.");
      if (await trialAlreadyUsed(input.email)) {
        throw new ApiError(409, "This email has already used a free trial. Request access or book a demo and we'll set you up.", "trial_used");
      }
      const domain = emailDomain(input.email);
      // One trial per company domain, once addresses are confirmed by email (otherwise
      // anyone could block a real company by signing up with its domain first).
      if (t.requireVerification) {
        const [taken] = await withSystem((tx) => tx`
          select 1 from organizations o where o.signup_domain = ${domain}
            and exists (select 1 from organization_members m join users u on u.id = m.user_id
                        where m.organization_id = o.id and u.email_verified_at is not null)`);
        if (taken) throw new ApiError(409, `Someone at ${domain} has already started a free trial. Ask them to invite you from Settings → Team, or book a call with us.`);
      }
      trial = { interviews: t.interviews, days: t.days, domain };
    } else {
      // Otherwise sign-up is approval-only: a team invitation, a one-time company link, or the shared access code.
      const { enabled, code } = await getSignupCode();
      if (!enabled || !code || !input.accessCode || !safeEqual(input.accessCode.trim(), code)) {
        throw new ApiError(403, "That access code isn't valid. Start a free trial instead, or request access to get a code.");
      }
    }
  }
  const { userId, orgId } = await signup({ ...input, trial, companyInviteToken: input.inviteToken ? undefined : input.companyInvite });
  await createSession(userId, orgId);
  if (trial && (await getTrialSettings()).requireVerification) await sendEmailVerification(userId);
  if (trial) {
    const t = trial;
    runInBackground("trial.email_admins", () => emailPlatformAdmins(emailTemplates.trialToAdmin({
      company: input.orgName!, name: input.name, email: input.email, interviews: t.interviews, days: t.days, link: `${env().APP_URL}/admin/companies/${orgId}`,
    }), mailbox(input.name, input.email)));
  }
  return { ok: true };
}, { rateLimit: { key: "signup", limit: 10, windowMs: 60 * 60_000 } });
