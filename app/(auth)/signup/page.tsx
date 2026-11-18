import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/session";
import { getInvite } from "@/lib/services/accounts";
import { getCompanyInvite, getTrialSettings } from "@/lib/services/platform";
import { SignupForm } from "@/components/auth/signup-form";
import { isWellFormedToken } from "@/lib/security/tokens";
import { DEMO_URL } from "@/lib/marketing";

export const metadata = { title: "Create account" };

export default async function SignupPage(props: PageProps<"/signup">) {
  const sp = await props.searchParams;
  const token = typeof sp.invite === "string" && isWellFormedToken(sp.invite) ? sp.invite : null;
  const companyToken = !token && typeof sp.company === "string" && isWellFormedToken(sp.company) ? sp.company : null;
  if (!token && !companyToken && (await getAuth())) redirect("/dashboard");
  const invite = token ? await getInvite(token) : null;
  const company = companyToken ? await getCompanyInvite(companyToken) : null;
  const linkBroken = (token && !invite) || (companyToken && !company);
  const trial = await getTrialSettings();
  // Open sign-up: a free trial by default; "?code=1" for people with an access code.
  const open = !token && !companyToken;
  const mode = open && trial.enabled && sp.code !== "1" ? "trial" : "code";
  // Chosen on the pricing page: after sign-up, Billing opens with this pack ready to buy.
  const pack = typeof sp.pack === "string" && /^\d{1,5}$/.test(sp.pack) && Number(sp.pack) > 0 ? Number(sp.pack) : null;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">
        {invite ? `Join ${invite.org_name}` : company ? `Set up ${company.company_name}` : mode === "trial" ? "Start your free trial" : "Create your workspace"}
      </h1>
      <p className="mt-1 mb-8 text-sm text-muted-foreground">
        {invite ? `You've been invited as ${invite.role}.`
          : company ? "Your access has been approved. Create your account to get started."
          : mode === "trial" ? `${trial.interviews} AI interviews free for ${trial.days} days. No credit card needed.`
          : "Enter the access code you received from our team."}
      </p>
      {open && pack && !linkBroken && (
        <p className="-mt-4 mb-6 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
          You chose <b>{pack} interviews</b>. Create your account first, and your pack is ready to buy straight after.
        </p>
      )}
      {linkBroken ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {token ? "This invitation is invalid or has expired. Ask your admin for a new one." : "This sign-up link is invalid, already used or expired. Please contact us for a new one."}
        </p>
      ) : (
        <SignupForm
          invite={invite && token ? { token, email: invite.email, orgName: invite.org_name } : null}
          company={company && companyToken ? { token: companyToken, email: company.email, name: company.company_name } : null}
          mode={mode}
          pack={open ? pack : null}
        />
      )}
      {open && mode === "trial" && (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Have an access code? <Link href="/signup?code=1" className="font-medium text-primary hover:underline">Use it here</Link>
        </p>
      )}
      {open && mode === "code" && (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {trial.enabled
            ? <>No access code? <Link href="/signup" className="font-medium text-primary hover:underline">Start a free trial</Link> or <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">book a demo</a>.</>
            : <>No access code yet? <Link href="/#contact" className="font-medium text-primary hover:underline">Request access</Link> or <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">book a demo</a>.</>}
        </p>
      )}
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account? <Link href="/login" className="font-medium text-primary hover:underline">Sign in</Link>
      </p>
    </>
  );
}
