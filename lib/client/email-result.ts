"use client";

import { toast } from "sonner";

/**
 * Actions that send email answer with `emailFailed`: the addresses the email provider refused.
 * The action itself still happened, so we say exactly that instead of a plain "sent".
 */
export function emailFailedIn(res: unknown): string[] {
  const f = (res as { emailFailed?: unknown } | null)?.emailFailed;
  return Array.isArray(f) ? f.filter((x): x is string => typeof x === "string") : [];
}

const who = (emails: string[]) =>
  emails.length === 1 ? emails[0] : emails.length === 2 ? `${emails[0]} and ${emails[1]}` : `${emails[0]} and ${emails.length - 1} others`;

/**
 * Show the success message, or, when some emails failed, a warning that says what was saved and
 * which emails didn't go out. `done` = what happened ("Interview scheduled"); `fix` = what to do now.
 */
export function toastEmailResult(res: unknown, done: string | undefined, fix = "Copy the link and send it yourself, or try again later.") {
  const failed = emailFailedIn(res);
  if (!failed.length) {
    if (done) toast.success(done);
    return;
  }
  toast.warning(`${done ? `${done.replace(/[.!]$/, "")}, but the` : "The"} email to ${who(failed)} couldn't be sent.`, {
    description: `${fix} The reason is in Settings → Email outbox.`,
    duration: 15_000,
    action: { label: "Email outbox", onClick: () => window.location.assign(new URL("/settings/notifications", window.location.origin)) },
  });
}
