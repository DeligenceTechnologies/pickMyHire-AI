import { describe, expect, it } from "vitest";
import { emailDomain, isWorkEmail } from "@/lib/validation/work-email";

describe("isWorkEmail", () => {
  it("accepts company addresses", () => {
    for (const e of ["priya@northwindtalent.com", "hr@acme.co.in", "Priya.Shah@Northwind.com", "a@sub.company.io"]) expect(isWorkEmail(e)).toBe(true);
  });
  it("turns away personal mailboxes", () => {
    for (const e of ["me@gmail.com", "me@yahoo.co.in", "me@Outlook.com", "me@hotmail.co.uk", "me@icloud.com", "me@rediffmail.com", "me@proton.me"]) expect(isWorkEmail(e)).toBe(false);
  });
  it("turns away throwaway services, including their subdomains", () => {
    for (const e of ["x@mailinator.com", "x@yopmail.com", "x@mail.mailinator.com", "x@10minutemail.com"]) expect(isWorkEmail(e)).toBe(false);
  });
  it("rejects malformed domains", () => {
    expect(isWorkEmail("x@localhost")).toBe(false);
    expect(isWorkEmail("nodomain")).toBe(false);
  });
  it("normalises the domain", () => {
    expect(emailDomain("  A@Acme.COM ")).toBe("acme.com");
  });
});
