import { describe, expect, it } from "vitest";
import {
  answersToHrDetails, computeFit, CustomQuestionSchema, DEFAULT_FORM, describeAnswers, NO_LIMITS, noticeDays, readForm, readLimits, validateAnswers,
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
      expected_ctc: "Enter a number", last_working_day: "Enter your last working day", relocation: "This answer is required",
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
    expect(computeFit(form, limits, { expected_ctc: 13.5 }, today)).toMatchObject({ level: "warn", items: [{ key: "budget", detail: expect.stringContaining("13% above") }] });
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
