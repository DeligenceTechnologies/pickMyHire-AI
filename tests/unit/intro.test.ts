import { describe, expect, it } from "vitest";
import { introLines } from "@/lib/interview/intro";

describe("interviewer introduction (played before the interview starts)", () => {
  const base = { firstName: "Priya", interviewerName: "Alex", jobTitle: "Sales Manager", companyName: "Northwind", minutes: 40 };

  it("greets the candidate, gives the length and explains how to answer and ask for repeats", () => {
    const lines = introLines(base);
    expect(lines[0]).toBe("Hi Priya, I'm Alex, the AI interviewer for the Sales Manager role at Northwind.");
    expect(lines.join(" ")).toContain("about 40 minutes");
    expect(lines.join(" ")).toContain('"Done answering"');
    expect(lines.join(" ")).toMatch(/twice for each question/);
    expect(lines.at(-1)).toContain('"Start interview"');
  });

  it("never names an interview section, and leaves out the length when it's unknown", () => {
    const lines = introLines({ ...base, minutes: null });
    expect(lines.join(" ")).not.toMatch(/minutes|section|let's begin with/i);
  });
});
