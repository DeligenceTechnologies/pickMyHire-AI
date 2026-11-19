// Total work experience, calculated from the start and end dates of each role in a resume (not guessed by
// the AI), with checks for dates that need a closer look. Pure functions: shared by the server and the UI.

export type ExperienceFlagKind = "missing_dates" | "end_before_start" | "future_date" | "gap" | "overlap" | "stated_mismatch" | "unreadable_date";
export type ExperienceFlag = { kind: ExperienceFlagKind; message: string };
export type RoleDuration = { title: string; company: string | null; months: number | null; approximate: boolean };
export type Experience = {
  /** Total months worked, overlapping roles counted once; null when no role has usable dates. */
  months: number | null;
  /** Some dates had only a year (or were partly missing), so the total is an estimate. */
  approximate: boolean;
  roles: RoleDuration[];
  flags: ExperienceFlag[];
};

type Role = { title: string; company: string | null; start: string | null; end: string | null };
type Point = { y: number; m: number; monthKnown: boolean };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const PRESENT = /^(to |till )?(present|current(ly)?|now|today|till\s*(date|now)|to\s*date|ongoing|continuing)( (day|role|job|working|employed))?$/i;
/** A gap between roles longer than this is worth asking about. */
export const GAP_MONTHS = 6;
/** A stated total this much higher than the dates show is flagged. */
export const STATED_MARGIN_MONTHS = 24;

/** Parse a resume date like "Jan 2020", "January 2020", "2020-01", "01/2020", "2020" or "Present". */
export function parseResumeDate(raw: string | null | undefined, today: Date = new Date()): Point | "present" | null | "unreadable" {
  if (!raw) return null;
  // Normalise quotes and spaces: "June ‘2021" → "June '2021".
  const s = raw.trim().replace(/[‘’`´]/g, "'").replace(/\s+/g, " ");
  if (!s) return null;
  if (PRESENT.test(s)) return "present";
  const year = (v: string) => { let y = Number(v); if (v.length === 2) y += y > (today.getFullYear() % 100) + 1 ? 1900 : 2000; return y >= 1950 && y <= 2100 ? y : null; };
  let m: RegExpMatchArray | null;
  // A month name with any separators and an optional day: "Jan 2020", "January, 2020", "Sept '19", "Jan/2020",
  // "Jan-2020", "Jun. 2020", "01-Jan-2020", "15 August 2020", "Jan 15, 2020", "Jan 15th 2020".
  if ((m = s.match(/^(?:\d{1,2}(?:st|nd|rd|th)?[\s./-]+)?([a-z]{3,9})\.?[\s,./-]*(?:\d{1,2}(?:st|nd|rd|th)?,?[\s./-]+)?'?(\d{4}|\d{2})$/i))) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    const y = year(m[2]);
    if (mi >= 0 && y) return { y, m: mi + 1, monthKnown: true };
  }
  // "2020-01", "2020/1"
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/))) {
    const y = year(m[1]), mo = Number(m[2]);
    if (y && mo >= 1 && mo <= 12) return { y, m: mo, monthKnown: true };
  }
  // "01/2020", "1-2020", "01.20", and "15/01/2020" (day ignored)
  if ((m = s.match(/^(?:\d{1,2}[-/.])?(\d{1,2})[-/.](\d{4}|\d{2})$/))) {
    const y = year(m[2]), mo = Number(m[1]);
    if (y && mo >= 1 && mo <= 12) return { y, m: mo, monthKnown: true };
  }
  // "2020"
  if ((m = s.match(/^(\d{4})$/))) {
    const y = year(m[1]);
    if (y) return { y, m: 1, monthKnown: false };
  }
  return "unreadable";
}

const idx = (p: Point) => p.y * 12 + (p.m - 1);
const fmtMonths = (n: number) => { const y = Math.floor(n / 12), m = n % 12; return [y && `${y} yr${y === 1 ? "" : "s"}`, m && `${m} mo${m === 1 ? "" : "s"}`].filter(Boolean).join(" ") || "less than a month"; };
export const formatExperience = (months: number | null, approximate = false) => months === null ? null : `${approximate ? "about " : ""}${fmtMonths(months)}`;
/** Compact form for tables: "5y 4m". */
export const shortExperience = (months: number | null) => months === null ? "—" : `${Math.floor(months / 12)}y ${months % 12}m`;

/**
 * Work out total experience from the roles. Each role counts from its start month through its end month
 * (both included); "Present" means this month. Overlapping roles are counted once.
 */
export function calculateExperience(roles: Role[], opts: { statedYears?: number | null; today?: Date } = {}): Experience {
  const today = opts.today ?? new Date();
  const now: Point = { y: today.getFullYear(), m: today.getMonth() + 1, monthKnown: true };
  const flags: ExperienceFlag[] = [];
  const add = (kind: ExperienceFlagKind, message: string) => { if (!flags.some((f) => f.message === message)) flags.push({ kind, message }); };
  const spans: { from: number; to: number; label: string }[] = [];
  let approximate = false;

  const durations: RoleDuration[] = roles.map((r) => {
    const label = [r.title, r.company].filter(Boolean).join(" at ") || "A role";
    const start = parseResumeDate(r.start, today);
    const end = parseResumeDate(r.end, today);
    const base = { title: r.title, company: r.company, months: null, approximate: false };
    if (start === "unreadable" || end === "unreadable") { add("unreadable_date", `${label}: the dates couldn't be read ("${[r.start, r.end].filter(Boolean).join(" – ")}").`); return base; }
    if (!start || start === "present") { add("missing_dates", `${label}: no start date.`); return base; }
    if (end === null) { add("missing_dates", `${label}: no end date (write "Present" for a current role).`); return base; }
    const to = end === "present" ? now : end;
    const yearOnly = !start.monthKnown || !to.monthKnown;
    if (idx(start) > idx(now) || (end !== "present" && idx(to) > idx(now))) { add("future_date", `${label}: a date is in the future.`); return base; }
    if (idx(to) < idx(start) && (to.y < start.y || (start.monthKnown && to.monthKnown))) { add("end_before_start", `${label}: the end date is before the start date.`); return base; }
    // Year only ("2019 – 2021"): counting January to December would overstate it, so use the middle of each year
    // (about 2 years here); a role starting and ending in the same year counts as half a year.
    const from = idx(start.monthKnown ? start : { ...start, m: 7 });
    const until = Math.max(idx(to.monthKnown ? to : { ...to, m: 6 }), from + (yearOnly && start.y === to.y ? 5 : 0));
    // Year-only dates are common; the total is shown as approximate ("about"), not as a problem.
    if (yearOnly) approximate = true;
    spans.push({ from, to: until, label });
    return { ...base, months: until - from + 1, approximate: yearOnly };
  });

  if (!spans.length) return { months: null, approximate: false, roles: durations, flags };

  // Merge overlapping or touching periods, and note overlaps and long gaps between them.
  spans.sort((a, b) => a.from - b.from);
  let total = 0;
  let cur = { ...spans[0] };
  for (const s of spans.slice(1)) {
    if (s.from <= cur.to) {
      const overlap = Math.min(cur.to, s.to) - s.from + 1;
      if (overlap >= 2) add("overlap", `${cur.label} and ${s.label} overlap by ${fmtMonths(overlap)} (counted once).`);
      if (s.to > cur.to) cur = { ...cur, to: s.to, label: s.label };
      continue;
    }
    const gap = s.from - cur.to - 1;
    if (gap > GAP_MONTHS) add("gap", `A gap of ${fmtMonths(gap)} before ${s.label}.`);
    total += cur.to - cur.from + 1;
    cur = { ...s };
  }
  total += cur.to - cur.from + 1;

  // The resume's own claim ("8+ years of experience") against the dates: worth checking when it claims
  // clearly more than the dates show (2+ years); approximate year-only dates explain smaller differences.
  const stated = opts.statedYears;
  if (stated != null && stated > 0 && stated * 12 - total >= STATED_MARGIN_MONTHS) {
    add("stated_mismatch", `The resume states ${stated} years of experience, but the dates add up to ${fmtMonths(total)}.`);
  }
  return { months: total, approximate, roles: durations, flags };
}
