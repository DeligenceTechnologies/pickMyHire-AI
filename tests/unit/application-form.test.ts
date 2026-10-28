import { describe, expect, it } from "vitest";
import {
  answersToHrDetails, computeFit, CustomQuestionSchema, DEFAULT_FORM, describeAnswers, NO_LIMITS, noticeDays, payHint, readForm, readLimits, readPay, validateAnswers,
  type ApplicationForm,
} from "@/lib/application-form";

const form: ApplicationForm = {
  ...DEFAULT_FORM,
  standard: { ...DEFAULT_FORM.standard, current_ctc: { enabled: true, required: false }, relocation: { enabled: true, required: true }, work_mode: { enabled: true, required: false } },
  custom: [
    { id: "permit01", label: "Valid work permit?", type: "yes_no", required: true, options: [], expected: "yes" },
    { id: "stack001", label: "Frameworks", type: "multi_choice", required: false, options: ["React", "Vue", "Angular"], expected: null },
    { id: "years001", label: "Years with SEO tools", type: "number", required: false, options: [], expected: null },
  ],
};
const today = new Date("2026-10-27T00:00:00Z");

describe("answers", () => {
  it("requires required questions and checks formats", () => {
    const { errors } = validateAnswers(form, { expected_ctc: "abc", notice_period: "serving", custom: { stack001: ["React", "Svelte"], years001: "x" } });
    expect(errors).toMatchObject({
      expected_ctc: "Enter a number, e.g. 12.5", last_working_day: "Enter your last working day", relocation: "This answer is required",
      "custom.permit01": "This answer is required", "custom.stack001": "Choose from the options", "custom.years001": "Enter a number",
    });
  });

  it("accepts valid answers and normalises them", () => {
    const { answers, errors } = validateAnswers(form, {
      expected_ctc: "12,5", current_ctc: "", notice_period: "30", joining_date: "2026-12-01", current_location: "  Pune ", relocation: "yes",
      work_mode: "hybrid", custom: { permit01: "yes", stack001: ["React", "React", "Vue"], years001: "4" },
    });
    expect(errors).toEqual({});
    expect(answers).toMatchObject({ expected_ctc: 125, notice_period: "30", current_location: "Pune", relocation: true, work_mode: "hybrid",
      custom: { permit01: "yes", stack001: ["React", "Vue"], years001: 4 } });
    expect(answers.current_ctc).toBeUndefined();
  });

  it("ignores questions that are switched off", () => {
    const { answers } = validateAnswers(DEFAULT_FORM, { current_ctc: "10", expected_ctc: "12", notice_period: "immediate" });
    expect(answers.current_ctc).toBeUndefined();
  });

  it("describes answers and fills HR details", () => {
    const a = { expected_ctc: 12, current_ctc: 9, notice_period: "serving" as const, last_working_day: "2026-11-20", relocation: false, custom: { permit01: "yes" } };
    expect(answersToHrDetails(form, a)).toEqual({ current_ctc: "9 LPA", expected_ctc: "12 LPA", notice_period: "Serving notice, last day 2026-11-20",
      joining_date: null, current_location: null, open_to_relocation: false });
    expect(describeAnswers(form, a).map((r) => r.value)).toEqual(["12 LPA", "9 LPA", "Serving notice, last day 2026-11-20", "No", "Yes"]);
  });
});

describe("fit check", () => {
  const limits = { ...NO_LIMITS, budget_min: 8, budget_max: 12, max_notice_days: 30, latest_joining_date: "2026-12-15", work_mode: "office" as const, relocation_required: true };
  it("passes when everything is within limits", () => {
    const fit = computeFit(form, limits, { expected_ctc: 11, notice_period: "15", joining_date: "2026-12-01", relocation: true, work_mode: "office", custom: { permit01: "yes" } }, today);
    expect(fit.level).toBe("ok");
    expect(fit.items.map((i) => i.key)).toEqual(["budget", "notice", "joining", "relocation", "work_mode", "custom.permit01"]);
  });
  it("marks a little over the budget to check, and far over as outside", () => {
    expect(computeFit(form, limits, { expected_ctc: 13.5 }, today)).toMatchObject({ level: "warn", items: [{ key: "budget", detail: expect.stringContaining("(13%) above") }] });
    expect(computeFit(form, limits, { expected_ctc: 16 }, today).level).toBe("fail");
  });
  it("checks notice period, including a serving notice", () => {
    expect(computeFit(form, limits, { notice_period: "45" }, today).level).toBe("warn");
    expect(computeFit(form, limits, { notice_period: "90_plus" }, today).level).toBe("fail");
    expect(noticeDays({ notice_period: "serving", last_working_day: "2026-11-06" }, today)).toBe(10);
    expect(computeFit(form, limits, { notice_period: "serving", last_working_day: "2026-11-06" }, today).level).toBe("ok");
  });
  it("flags an unexpected answer and relocation", () => {
    expect(computeFit(form, limits, { custom: { permit01: "no" } }, today).level).toBe("fail");
    expect(computeFit(form, limits, { relocation: false }, today).level).toBe("fail");
    expect(computeFit(form, limits, { work_mode: "remote" }, today).level).toBe("warn");
  });
  it("has nothing to say without limits or answers", () => {
    expect(computeFit(form, NO_LIMITS, { expected_ctc: 50 }, today).level).toBe("none");
    expect(computeFit(form, limits, null, today).level).toBe("none");
  });
});

describe("job settings", () => {
  it("falls back to the defaults for missing or broken settings", () => {
    expect(readForm(null)).toEqual(DEFAULT_FORM);
    expect(readForm({ currency: "XYZ" })).toEqual(DEFAULT_FORM);
    expect(readLimits(undefined)).toEqual(NO_LIMITS);
  });
  it("checks custom questions", () => {
    expect(CustomQuestionSchema.safeParse({ id: "abcdef12", label: "Pick", type: "single_choice", required: true, options: ["A"] }).success).toBe(false);
    expect(CustomQuestionSchema.safeParse({ id: "abcdef12", label: "Pick", type: "single_choice", required: true, options: ["A", "B"], expected: "C" }).success).toBe(false);
    expect(CustomQuestionSchema.safeParse({ id: "abcdef12", label: "Pick", type: "single_choice", required: true, options: ["A", "B"], expected: "B" }).success).toBe(true);
  });
});

describe("reading pay answers", () => {
  it("reads LPA, and converts a full yearly amount typed in an LPA box", () => {
    expect(readPay("12.5", "lpa", "INR")).toEqual({ ok: true, value: 12.5, converted: false });
    expect(readPay("13,00,000", "lpa", "INR")).toEqual({ ok: true, value: 13, converted: true });
    expect(readPay("540000", "lpa", "INR")).toEqual({ ok: true, value: 5.4, converted: true });
    expect(readPay("₹ 12 LPA", "lpa", "INR")).toEqual({ ok: true, value: 12, converted: false });
  });

  it("refuses amounts it can't read safely, with a hint", () => {
    expect(readPay("45000", "lpa", "INR")).toMatchObject({ ok: false, error: expect.stringMatching(/lakhs per year, e\.g\. 12\.5 for ₹12,50,000/) });
    expect(readPay("750", "lpa", "INR")).toMatchObject({ ok: false });
    expect(readPay("90000000000", "lpa", "INR")).toMatchObject({ ok: false });
    expect(readPay("12abc", "lpa", "INR")).toMatchObject({ ok: false });
    expect(readPay("90", "year", "USD")).toMatchObject({ ok: false, error: expect.stringMatching(/full yearly amount/) });
    expect(readPay("90000", "year", "USD")).toEqual({ ok: true, value: 90000, converted: false });
  });

  it("explains what the amount means", () => {
    expect(payHint(readPay("12.5", "lpa", "INR"), "lpa", "INR")).toBe("= ₹12,50,000 per year");
    expect(payHint(readPay("1300000", "lpa", "INR"), "lpa", "INR")).toBe("Read as 13 LPA (₹13,00,000 per year)");
    expect(payHint(readPay("7500", "month", "USD"), "month", "USD")).toBe("= $7,500 per month");
  });

  it("validates answers with the same rules", () => {
    const { answers, errors } = validateAnswers(DEFAULT_FORM, { expected_ctc: "13,00,000", notice_period: "30" });
    expect(answers.expected_ctc).toBe(13);
    expect(errors).toEqual({});
    expect(validateAnswers(DEFAULT_FORM, { expected_ctc: "45000", notice_period: "30" }).errors.expected_ctc).toMatch(/lakhs per year/);
  });

  it("corrects old answers saved as a full yearly amount, and never shows a nonsense percentage", () => {
    const limits = { ...NO_LIMITS, budget_min: 5, budget_max: 12 };
    const inBudget = computeFit(DEFAULT_FORM, limits, { expected_ctc: 540000 });
    expect(inBudget.level).toBe("ok");
    expect(inBudget.items[0].detail).toBe("Expects 5.4 LPA (budget 5 LPA–12 LPA)");
    const slightlyOver = computeFit(DEFAULT_FORM, limits, { expected_ctc: 1300000 });
    expect(slightlyOver.level).toBe("warn");
    expect(slightlyOver.items[0].detail).toBe("Expects 13 LPA: 1 LPA (8%) above the budget (5 LPA–12 LPA)");
    const unusual = computeFit(DEFAULT_FORM, limits, { expected_ctc: 90 });
    expect(unusual.items[0]).toMatchObject({ level: "warn", detail: expect.stringMatching(/looks unusual/) });
  });
});
