// Application questions, hiring limits and the fit check. Shared by the browser
// (forms) and the server (validation), so both apply exactly the same rules.
// The fit check is plain arithmetic, never AI: salary and notice period are
// compared with the job's internal limits, and anything outside them is flagged
// for a person to look at. Nothing here rejects a candidate.

import { z } from "zod";

// ---------------------------------------------------------------- pay units

export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD"] as const;
export type Currency = (typeof CURRENCIES)[number];
/** LPA = lakhs per annum (India). */
export const PAY_UNITS = ["lpa", "year", "month"] as const;
export type PayUnit = (typeof PAY_UNITS)[number];
export const PAY_UNIT_LABEL: Record<PayUnit, string> = { lpa: "LPA (lakhs per year)", year: "per year", month: "per month" };

export function payLabel(currency: Currency, unit: PayUnit) {
  return unit === "lpa" ? `${currency === "INR" ? "₹" : `${currency} `}LPA` : `${currency} ${unit === "year" ? "per year" : "per month"}`;
}

export function formatPay(amount: number, currency: Currency, unit: PayUnit) {
  const n = amount.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return unit === "lpa" ? `${n} LPA` : `${currency} ${n} ${unit === "year" ? "per year" : "per month"}`;
}

// ---------------------------------------------------------------- reading pay answers

/** Highest believable LPA (₹5 crore a year); anything above is almost always a typing slip. */
export const MAX_LPA = 500;
const LAKH = 100_000;
const SYMBOL: Partial<Record<Currency, string>> = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };
const money = (n: number, currency: Currency) => {
  const s = n.toLocaleString(currency === "INR" ? "en-IN" : "en-US", { maximumFractionDigits: 2 });
  return SYMBOL[currency] ? `${SYMBOL[currency]}${s}` : `${currency} ${s}`;
};

export type PayReading = { ok: true; value: number; converted: boolean } | { ok: false; error: string };

/**
 * Read a pay amount typed by a candidate or recruiter, in the job's pay unit.
 * People often type the full yearly amount in an LPA box (13,00,000 for 13 LPA):
 * that's converted. Amounts that can't be read safely are refused with a hint,
 * instead of being saved and breaking the fit check.
 */
export function readPay(raw: unknown, unit: PayUnit, currency: Currency): PayReading {
  const text = String(raw ?? "").trim().replace(/[,\s₹$€£]/g, "").replace(/(lpa|lakhs?|lacs?)$/i, "");
  if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, error: unit === "lpa" ? "Enter a number, e.g. 12.5" : "Enter a number" };
  const n = Number(text);
  const round = (x: number) => Math.round(x * 100) / 100;
  if (unit === "lpa") {
    const example = `Enter it in lakhs per year, e.g. 12.5 for ${money(12.5 * LAKH, currency)}`;
    if (n <= MAX_LPA) return { ok: true, value: round(n), converted: false };
    if (n < 1000) return { ok: false, error: `That's more than ${MAX_LPA} lakhs a year. ${example}.` };
    if (n < LAKH) return { ok: false, error: `This doesn't look like a yearly amount. ${example}.` };
    const lpa = n / LAKH;
    if (lpa > MAX_LPA) return { ok: false, error: `That's more than ${MAX_LPA} lakhs a year. ${example}.` };
    return { ok: true, value: round(lpa), converted: true };
  }
  if (unit === "year" && n > 0 && n < 1000) return { ok: false, error: `Enter the full yearly amount, e.g. ${money(90000, currency)} (not 90 or 90k).` };
  if (unit === "month" && n > 0 && n < 100) return { ok: false, error: `Enter the full monthly amount, e.g. ${money(7500, currency)}.` };
  if (n > 1e9) return { ok: false, error: "That amount is too large. Check the number." };
  return { ok: true, value: round(n), converted: false };
}

/** What the amount means, shown under the box as people type. */
export function payHint(reading: PayReading, unit: PayUnit, currency: Currency): string | null {
  if (!reading.ok) return null;
  const v = reading.value;
  if (unit === "lpa") return reading.converted ? `Read as ${formatPay(v, currency, unit)} (${money(v * LAKH, currency)} per year)` : `= ${money(v * LAKH, currency)} per year`;
  return `= ${money(v, currency)} ${unit === "year" ? "per year" : "per month"}`;
}

/** The hint before anything is typed. */
export function payPlaceholderHint(unit: PayUnit, currency: Currency) {
  return unit === "lpa" ? `In lakhs per year: 12.5 means ${money(12.5 * LAKH, currency)}` : unit === "year" ? "The full yearly amount" : "The full monthly amount";
}

/** Answers saved before readPay existed may hold a full yearly amount in an LPA job. */
export function storedPay(n: number | null | undefined, unit: PayUnit): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return unit === "lpa" && n >= LAKH ? Math.round((n / LAKH) * 100) / 100 : n;
}

// ---------------------------------------------------------------- questions

export const STANDARD_QUESTIONS = ["expected_ctc", "current_ctc", "notice_period", "joining_date", "current_location", "relocation", "work_mode"] as const;
export type StandardKey = (typeof STANDARD_QUESTIONS)[number];
export const STANDARD_LABEL: Record<StandardKey, string> = {
  expected_ctc: "Expected CTC",
  current_ctc: "Current CTC",
  notice_period: "Notice period",
  joining_date: "Earliest joining date",
  current_location: "Current location",
  relocation: "Open to relocation?",
  work_mode: "Preferred work mode",
};

export const NOTICE_OPTIONS = ["immediate", "15", "30", "45", "60", "90", "90_plus", "serving"] as const;
export type Notice = (typeof NOTICE_OPTIONS)[number];
export const NOTICE_LABEL: Record<Notice, string> = {
  immediate: "Immediate", "15": "15 days", "30": "30 days", "45": "45 days", "60": "60 days", "90": "90 days",
  "90_plus": "More than 90 days", serving: "Serving notice period",
};
export const WORK_MODES = ["office", "hybrid", "remote"] as const;
export type WorkMode = (typeof WORK_MODES)[number];
export const WORK_MODE_LABEL: Record<WorkMode, string> = { office: "In office", hybrid: "Hybrid", remote: "Remote" };

export const QUESTION_TYPES = ["short_text", "long_text", "number", "yes_no", "single_choice", "multi_choice", "date"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  short_text: "Short answer", long_text: "Long answer", number: "Number", yes_no: "Yes / No",
  single_choice: "Single choice", multi_choice: "Multiple choice", date: "Date",
};

const toggle = z.object({ enabled: z.boolean(), required: z.boolean() });
export const CustomQuestionSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{6,16}$/),
  label: z.string().trim().min(1, "Write the question").max(200),
  type: z.enum(QUESTION_TYPES),
  required: z.boolean(),
  options: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  /** Optional expected answer (yes/no and single choice): a different answer is flagged. */
  expected: z.string().trim().max(80).nullable().default(null),
}).superRefine((q, ctx) => {
  if ((q.type === "single_choice" || q.type === "multi_choice") && q.options.length < 2) ctx.addIssue({ code: "custom", path: ["options"], message: "Add at least two options" });
  if (q.expected && q.type === "yes_no" && !["yes", "no"].includes(q.expected)) ctx.addIssue({ code: "custom", path: ["expected"], message: "Expected answer must be Yes or No" });
  if (q.expected && q.type === "single_choice" && !q.options.includes(q.expected)) ctx.addIssue({ code: "custom", path: ["expected"], message: "Expected answer must be one of the options" });
});
export type CustomQuestion = z.infer<typeof CustomQuestionSchema>;

export const ApplicationFormSchema = z.object({
  currency: z.enum(CURRENCIES),
  pay_unit: z.enum(PAY_UNITS),
  standard: z.object({
    expected_ctc: toggle, current_ctc: toggle, notice_period: toggle, joining_date: toggle,
    current_location: toggle, relocation: toggle, work_mode: toggle,
  }),
  custom: z.array(CustomQuestionSchema).max(20),
});
export type ApplicationForm = z.infer<typeof ApplicationFormSchema>;

/** The form a job uses until the team changes it. */
export const DEFAULT_FORM: ApplicationForm = {
  currency: "INR",
  pay_unit: "lpa",
  standard: {
    expected_ctc: { enabled: true, required: true },
    current_ctc: { enabled: false, required: false },
    notice_period: { enabled: true, required: true },
    joining_date: { enabled: true, required: false },
    current_location: { enabled: true, required: false },
    relocation: { enabled: false, required: false },
    work_mode: { enabled: false, required: false },
  },
  custom: [],
};

export function readForm(raw: unknown): ApplicationForm {
  const r = ApplicationFormSchema.safeParse(raw);
  return r.success ? r.data : DEFAULT_FORM;
}

// ---------------------------------------------------------------- hiring limits (internal)

const amount = z.number().finite().min(0).max(1e12).nullable().default(null);
export const HiringLimitsSchema = z.object({
  budget_min: amount,
  budget_max: amount,
  max_notice_days: z.number().int().min(0).max(365).nullable().default(null),
  latest_joining_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  work_mode: z.enum(WORK_MODES).nullable().default(null),
  relocation_required: z.boolean().default(false),
}).refine((l) => l.budget_min == null || l.budget_max == null || l.budget_min <= l.budget_max, { path: ["budget_min"], message: "Minimum can't be more than maximum" });
export type HiringLimits = z.infer<typeof HiringLimitsSchema>;
export const NO_LIMITS: HiringLimits = { budget_min: null, budget_max: null, max_notice_days: null, latest_joining_date: null, work_mode: null, relocation_required: false };

export function readLimits(raw: unknown): HiringLimits {
  const r = HiringLimitsSchema.safeParse(raw);
  return r.success ? r.data : NO_LIMITS;
}

// ---------------------------------------------------------------- answers

export type Answers = {
  expected_ctc?: number | null;
  current_ctc?: number | null;
  notice_period?: Notice | null;
  last_working_day?: string | null;
  joining_date?: string | null;
  current_location?: string | null;
  relocation?: boolean | null;
  work_mode?: WorkMode | null;
  custom?: Record<string, string | string[] | number | boolean | null>;
};

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const blank = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** Validate answers against a job's form: required fields, formats and allowed values. */
export function validateAnswers(form: ApplicationForm, raw: Record<string, unknown>): { answers: Answers; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const answers: Answers = { custom: {} };
  const need = (key: string, v: unknown, required: boolean) => {
    if (blank(v)) { if (required) errors[key] = "This answer is required"; return false; }
    return true;
  };
  const s = form.standard;
  for (const key of ["expected_ctc", "current_ctc"] as const) {
    if (!s[key].enabled) continue;
    const v = raw[key];
    if (!need(key, v, s[key].required)) continue;
    const r = readPay(v, form.pay_unit, form.currency);
    if (!r.ok) errors[key] = r.error; else answers[key] = r.value;
  }
  if (s.notice_period.enabled && need("notice_period", raw.notice_period, s.notice_period.required)) {
    const v = String(raw.notice_period);
    if (!(NOTICE_OPTIONS as readonly string[]).includes(v)) errors.notice_period = "Choose an option";
    else {
      answers.notice_period = v as Notice;
      if (v === "serving") {
        const d = date.safeParse(raw.last_working_day);
        if (!d.success) errors.last_working_day = "Enter your last working day"; else answers.last_working_day = d.data;
      }
    }
  }
  if (s.joining_date.enabled && need("joining_date", raw.joining_date, s.joining_date.required)) {
    const d = date.safeParse(raw.joining_date);
    if (!d.success) errors.joining_date = "Choose a date"; else answers.joining_date = d.data;
  }
  if (s.current_location.enabled && need("current_location", typeof raw.current_location === "string" ? raw.current_location.trim() : raw.current_location, s.current_location.required)) {
    answers.current_location = String(raw.current_location).trim().slice(0, 120);
  }
  if (s.relocation.enabled && need("relocation", raw.relocation, s.relocation.required)) {
    const v = String(raw.relocation);
    if (v !== "yes" && v !== "no" && v !== "true" && v !== "false") errors.relocation = "Choose Yes or No";
    else answers.relocation = v === "yes" || v === "true";
  }
  if (s.work_mode.enabled && need("work_mode", raw.work_mode, s.work_mode.required)) {
    const v = String(raw.work_mode);
    if (!(WORK_MODES as readonly string[]).includes(v)) errors.work_mode = "Choose an option"; else answers.work_mode = v as WorkMode;
  }
  const custom = (raw.custom ?? {}) as Record<string, unknown>;
  for (const q of form.custom) {
    const key = `custom.${q.id}`;
    let v = custom[q.id];
    if (typeof v === "string") v = v.trim();
    if (!need(key, v, q.required)) continue;
    switch (q.type) {
      case "short_text": answers.custom![q.id] = String(v).slice(0, 300); break;
      case "long_text": answers.custom![q.id] = String(v).slice(0, 3000); break;
      case "number": { const n = Number(String(v).replace(/,/g, "")); if (!Number.isFinite(n)) errors[key] = "Enter a number"; else answers.custom![q.id] = n; break; }
      case "date": { const d = date.safeParse(v); if (!d.success) errors[key] = "Choose a date"; else answers.custom![q.id] = d.data; break; }
      case "yes_no": { const t = String(v); if (t !== "yes" && t !== "no") errors[key] = "Choose Yes or No"; else answers.custom![q.id] = t; break; }
      case "single_choice": { const t = String(v); if (!q.options.includes(t)) errors[key] = "Choose an option"; else answers.custom![q.id] = t; break; }
      case "multi_choice": {
        const arr = (Array.isArray(v) ? v : [v]).map(String);
        if (!arr.every((x) => q.options.includes(x))) errors[key] = "Choose from the options"; else answers.custom![q.id] = [...new Set(arr)];
        break;
      }
    }
  }
  return { answers, errors };
}

/** Days until the candidate can start, from the notice-period answer. */
export function noticeDays(a: Answers, today = new Date()): number | null {
  if (!a.notice_period) return null;
  if (a.notice_period === "immediate") return 0;
  if (a.notice_period === "90_plus") return 120;
  if (a.notice_period === "serving") {
    if (!a.last_working_day) return null;
    return Math.max(0, Math.ceil((Date.parse(`${a.last_working_day}T00:00:00Z`) - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / 86_400_000));
  }
  return Number(a.notice_period);
}

export function noticeText(a: Answers) {
  if (!a.notice_period) return null;
  return a.notice_period === "serving" ? `Serving notice${a.last_working_day ? `, last day ${a.last_working_day}` : ""}` : NOTICE_LABEL[a.notice_period];
}

// ---------------------------------------------------------------- fit check

export type FitLevel = "ok" | "warn" | "fail";
export type FitItem = { key: string; label: string; level: FitLevel; detail: string };
export type Fit = { level: FitLevel | "none"; items: FitItem[] };

/** Up to this much above the budget maximum is "check", beyond it "outside". */
export const BUDGET_WARN_RATIO = 0.15;
/** Notice up to this many days over the limit is "check", beyond it "outside". */
const NOTICE_WARN_DAYS = 30;
const JOIN_WARN_DAYS = 14;

export function computeFit(form: ApplicationForm, limits: HiringLimits, a: Answers | null, today = new Date()): Fit {
  const items: FitItem[] = [];
  if (!a) return { level: "none", items };
  const pay = (n: number) => formatPay(n, form.currency, form.pay_unit);
  const expected = storedPay(a.expected_ctc, form.pay_unit);
  if (limits.budget_max != null && expected != null) {
    const range = limits.budget_min != null ? `${pay(limits.budget_min)}–${pay(limits.budget_max)}` : `up to ${pay(limits.budget_max)}`;
    const over = limits.budget_max > 0 ? (expected - limits.budget_max) / limits.budget_max : expected > 0 ? Infinity : 0;
    if (over <= 0) items.push({ key: "budget", label: "Budget", level: "ok", detail: `Expects ${pay(expected)} (budget ${range})` });
    else if (over > 3 || (form.pay_unit === "lpa" && expected > MAX_LPA)) {
      // Far outside anything realistic: most likely a typing slip, so ask for a check instead of rejecting.
      items.push({ key: "budget", label: "Budget", level: "warn", detail: `Expects ${pay(expected)}, which looks unusual for a budget of ${range}. Check the answer.` });
    } else {
      items.push({ key: "budget", label: "Budget", level: over <= BUDGET_WARN_RATIO ? "warn" : "fail",
        detail: `Expects ${pay(expected)}: ${pay(Math.round((expected - limits.budget_max) * 100) / 100)} (${Math.max(1, Math.round(over * 100))}%) above the budget (${range})` });
    }
  }
  const days = noticeDays(a, today);
  if (limits.max_notice_days != null && days != null) {
    const over = days - limits.max_notice_days;
    items.push({ key: "notice", label: "Notice period", level: over <= 0 ? "ok" : over <= NOTICE_WARN_DAYS ? "warn" : "fail",
      detail: `${noticeText(a)} (limit ${limits.max_notice_days} days)` });
  }
  if (limits.latest_joining_date && a.joining_date) {
    const late = (Date.parse(a.joining_date) - Date.parse(limits.latest_joining_date)) / 86_400_000;
    items.push({ key: "joining", label: "Joining date", level: late <= 0 ? "ok" : late <= JOIN_WARN_DAYS ? "warn" : "fail",
      detail: `Can join from ${a.joining_date} (needed by ${limits.latest_joining_date})` });
  }
  if (limits.relocation_required && a.relocation != null) {
    items.push({ key: "relocation", label: "Relocation", level: a.relocation ? "ok" : "fail", detail: a.relocation ? "Open to relocate" : "Not open to relocate" });
  }
  if (limits.work_mode && a.work_mode) {
    items.push({ key: "work_mode", label: "Work mode", level: a.work_mode === limits.work_mode ? "ok" : "warn",
      detail: `Prefers ${WORK_MODE_LABEL[a.work_mode].toLowerCase()} (role is ${WORK_MODE_LABEL[limits.work_mode].toLowerCase()})` });
  }
  for (const q of form.custom) {
    if (!q.expected) continue;
    const v = a.custom?.[q.id];
    if (v == null || v === "") continue;
    const ok = String(v) === q.expected;
    items.push({ key: `custom.${q.id}`, label: q.label, level: ok ? "ok" : "fail", detail: `Answered “${String(v) === "yes" ? "Yes" : String(v) === "no" ? "No" : String(v)}”` });
  }
  const level: Fit["level"] = !items.length ? "none" : items.some((i) => i.level === "fail") ? "fail" : items.some((i) => i.level === "warn") ? "warn" : "ok";
  return { level, items };
}

export const FIT_LABEL: Record<Fit["level"], string> = { ok: "Fits limits", warn: "Check limits", fail: "Outside limits", none: "No limits set" };

/** The standard answers as HR details (one shared record per candidate). */
export function answersToHrDetails(form: ApplicationForm, a: Answers) {
  const pay = (n: number | null | undefined) => { const v = storedPay(n, form.pay_unit); return v == null ? null : formatPay(v, form.currency, form.pay_unit); };
  return {
    current_ctc: pay(a.current_ctc),
    expected_ctc: pay(a.expected_ctc),
    notice_period: noticeText(a),
    joining_date: a.joining_date ?? null,
    current_location: a.current_location ?? null,
    open_to_relocation: a.relocation ?? null,
  };
}

/** A short random id for a new custom question. */
export function newQuestionId() {
  return Math.random().toString(36).slice(2, 10).padEnd(8, "0");
}

/** Answers as readable label/value pairs, in the order the questions appear. */
export function describeAnswers(form: ApplicationForm, a: Answers): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const s = form.standard;
  const pay = (n: number | null | undefined) => { const v = storedPay(n, form.pay_unit); return v == null ? null : formatPay(v, form.currency, form.pay_unit); };
  const add = (label: string, value: string | null | undefined) => { if (value != null && value !== "") out.push({ label, value }); };
  if (s.expected_ctc.enabled || a.expected_ctc != null) add(STANDARD_LABEL.expected_ctc, pay(a.expected_ctc));
  if (s.current_ctc.enabled || a.current_ctc != null) add(STANDARD_LABEL.current_ctc, pay(a.current_ctc));
  add(STANDARD_LABEL.notice_period, noticeText(a));
  add(STANDARD_LABEL.joining_date, a.joining_date);
  add(STANDARD_LABEL.current_location, a.current_location);
  add(STANDARD_LABEL.relocation, a.relocation == null ? null : a.relocation ? "Yes" : "No");
  add(STANDARD_LABEL.work_mode, a.work_mode ? WORK_MODE_LABEL[a.work_mode] : null);
  for (const q of form.custom) {
    const v = a.custom?.[q.id];
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    add(q.label, Array.isArray(v) ? v.join(", ") : v === "yes" ? "Yes" : v === "no" ? "No" : String(v));
  }
  return out;
}
