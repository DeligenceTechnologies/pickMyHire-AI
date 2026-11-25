import { describe, expect, it } from "vitest";
import { introLines } from "@/lib/interview/intro";

describe("interviewer introduction (played before the interview starts)", () => {
  const base = { firstName: "Priya", interviewerName: "Alex", jobTitle: "Sales Manager", companyName: "Northwind", minutes: 40 };

  it("greets the candidate, gives the length and explains how to answer and ask for repeats", () => {
    const lines = introLines(base);
    expect(lines[0]).toBe("Hi Priya, I'm Alex, the AI interviewer for the Sales Manager role at Northwind.");
    // A range, not a fixed number: the real length depends on the answers.
    expect(lines.join(" ")).toContain("usually takes 30 to 45 minutes, depending on your answers");
    expect(lines.join(" ")).toContain("If you don't know an answer, just say so and we'll move on.");
    expect(lines.join(" ")).toContain('"Done answering"');
    expect(lines.join(" ")).toMatch(/twice for each question/);
    expect(lines.at(-1)).toContain('"Start interview"');
  });

  it("never names an interview section, and leaves out the length when it's unknown", () => {
    const lines = introLines({ ...base, minutes: null });
    expect(lines.join(" ")).not.toMatch(/minutes|section|let's begin with/i);
  });
});

describe("skipping a question and the length range", async () => {
  const { isSkipReply } = await import("@/lib/interview/skip");
  const { durationRange, durationText } = await import("@/lib/interview/duration");
  it("treats a short 'I don't know' or 'skip' as a skip, but not an answer that only starts that way", () => {
    for (const t of ["I don't know.", "Sorry, I have no idea", "Can we skip this one?", "I haven't worked with Kafka", "Not sure, next question please", "I dont know"]) expect(isSkipReply(t), t).toBe(true);
    for (const t of ["I don't know the exact number, but we cut the cost by half after moving the reports to a nightly batch job on Postgres.", "Yes, I used it daily", "Can you repeat the question?", ""]) expect(isSkipReply(t), t).toBe(false);
  });
  it("gives a rounded range around the planned length", () => {
    expect(durationRange(26)).toEqual({ low: 20, high: 30 });
    expect(durationText(49)).toBe("35–55 minutes");
    expect(durationText(12, "spoken")).toBe("10 to 15 minutes");
    expect(durationText(null)).toBeNull();
  });
});
