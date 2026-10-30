import { describe, expect, it } from "vitest";
import { buildTranscriptionPrompt } from "@/prompts/transcription/v1";

describe("transcription prompt", () => {
  it("names the role, company, candidate and the unique terms", () => {
    const p = buildTranscriptionPrompt({ jobTitle: "Business Development Executive", companyName: "Northwind", candidateName: "Tirth Patel", terms: ["Vesta", "BuildWise", "Airtable", "vesta", "  Upwork  "] });
    expect(p).toBe("A job interview for the Business Development Executive role at Northwind, with the candidate Tirth Patel. Names and terms that may come up: Vesta, BuildWise, Airtable, Upwork.");
  });

  it("skips over-long terms and stays within the size limit", () => {
    const terms = ["x".repeat(60), ...Array.from({ length: 200 }, (_, i) => `Term number ${i}`)];
    const p = buildTranscriptionPrompt({ jobTitle: "Engineer", companyName: "Acme", candidateName: "Sam", terms });
    expect(p).not.toContain("x".repeat(60));
    expect(p.length).toBeLessThanOrEqual(900);
    expect(p.split(",").length).toBeLessThanOrEqual(41);
  });

  it("works without terms", () => {
    expect(buildTranscriptionPrompt({ jobTitle: "Engineer", companyName: "Acme", candidateName: "Sam", terms: [] })).toBe("A job interview for the Engineer role at Acme, with the candidate Sam.");
  });
});
