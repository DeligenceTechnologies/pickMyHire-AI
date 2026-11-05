import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
import { emailFailedIn, toastEmailResult } from "@/lib/client/email-result";

beforeEach(() => { toast.success.mockClear(); toast.warning.mockClear(); });

describe("telling the user when an email failed", () => {
  it("reads the failed addresses from an action's response", () => {
    expect(emailFailedIn({ emailFailed: ["a@x.test"] })).toEqual(["a@x.test"]);
    expect(emailFailedIn({ link: "x" })).toEqual([]);
    expect(emailFailedIn(null)).toEqual([]);
    expect(emailFailedIn({ emailFailed: "nope" })).toEqual([]);
  });

  it("shows the normal success when every email went out", () => {
    toastEmailResult({ emailFailed: [] }, "Invitation sent");
    expect(toast.success).toHaveBeenCalledWith("Invitation sent");
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("warns instead, naming who didn't get it and what to do", () => {
    toastEmailResult({ emailFailed: ["rahul@x.test"] }, "Interview scheduled", "Use “Copy invite”.");
    expect(toast.success).not.toHaveBeenCalled();
    const [title, opts] = toast.warning.mock.calls[0];
    expect(title).toBe("Interview scheduled, but the email to rahul@x.test couldn't be sent.");
    expect(opts.description).toBe("Use “Copy invite”. The reason is in Settings → Email outbox.");
  });

  it("summarises several addresses", () => {
    toastEmailResult({ emailFailed: ["a@x.test", "b@x.test"] }, "Interview cancelled");
    expect(toast.warning.mock.calls[0][0]).toBe("Interview cancelled, but the email to a@x.test and b@x.test couldn't be sent.");
    toastEmailResult({ emailFailed: ["a@x.test", "b@x.test", "c@x.test"] }, undefined);
    expect(toast.warning.mock.calls[1][0]).toBe("The email to a@x.test and 2 others couldn't be sent.");
  });
});
