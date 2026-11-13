"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { safeNext } from "@/lib/security/safe-redirect";
import { AuthForm } from "./auth-form";

export function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  return (
    <AuthForm
      endpoint="/api/auth/login"
      submitLabel="Sign in"
      fields={[
        { name: "email", label: "Work email", type: "email", autoComplete: "email", placeholder: "you@company.com" },
        { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
      ]}
      onSuccess={(res) => {
        router.push(safeNext(next) ?? (typeof res.home === "string" ? res.home : "/dashboard"));
        router.refresh();
      }}
    />
  );
}
