"use client";

import { useRouter } from "next/navigation";
import { AuthForm, type Field } from "./auth-form";

export function SignupForm({ invite, company, mode = "code", pack = null }: {
  invite: { token: string; email: string; orgName: string } | null;
  company?: { token: string; email: string; name: string } | null;
  /** Without an invite or approval link: start a free trial, or use an access code. */
  mode?: "trial" | "code";
  /** A pack chosen on the pricing page: after sign-up, go to Billing with it selected. */
  pack?: number | null;
}) {
  const router = useRouter();
  const preset = invite?.email ?? company?.email;
  const open = !invite && !company;
  const trial = open && mode === "trial";
  const fields: Field[] = [
    { name: "name", label: "Full name", autoComplete: "name" },
    { name: "email", label: "Work email", type: "email", autoComplete: "email", defaultValue: preset, readOnly: !!preset, ...(trial ? { hint: "Use your company email. Personal addresses (Gmail, Yahoo…) can't start a trial." } : {}) },
    ...(trial ? [{ name: "orgName", label: "Company name", autoComplete: "organization", placeholder: "Acme Inc." }] : []),
    ...(open && !trial ? [
      { name: "orgName", label: "Company / workspace name", autoComplete: "organization", placeholder: "Acme Inc.", optional: true },
      { name: "accessCode", label: "Access code", autoComplete: "off", hint: "Provided by the PickMyHire.ai team after approval." },
    ] : []),
    { name: "password", label: "Password", type: "password", autoComplete: "new-password", hint: "At least 10 characters." },
  ];
  return (
    <AuthForm
      endpoint="/api/auth/signup"
      submitLabel={invite ? `Join ${invite.orgName}` : company ? `Create ${company.name}` : trial ? "Start free trial" : "Create workspace"}
      fields={fields}
      extra={{ inviteToken: invite?.token, companyInvite: company?.token, trial: trial || undefined }}
      onSuccess={() => {
        router.push(pack ? `/settings/billing?pack=${pack}` : "/dashboard");
        router.refresh();
      }}
    />
  );
}
