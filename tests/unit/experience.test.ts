import { describe, expect, it } from "vitest";
import { calculateExperience, formatExperience, parseResumeDate, shortExperience } from "@/lib/resume/experience";

const today = new Date(2026, 10, 19); // 19 Nov 2026
const role = (start: string | null, end: string | null, title = "Engineer", company: string | null = "Acme") => ({ title, company, start, end });
const kinds = (r: ReturnType<typeof calculateExperience>) => r.flags.map((f) => f.kind);

describe("reading resume dates", () => {
  it("understands the usual formats", () => {
    expect(parseResumeDate("Jan 2020", today)).toEqual({ y: 2020, m: 1, monthKnown: true });
    expect(parseResumeDate("September, 2019", today)).toEqual({ y: 2019, m: 9, monthKnown: true });
    expect(parseResumeDate("Sept '19", today)).toEqual({ y: 2019, m: 9, monthKnown: true });
    expect(parseResumeDate("2021-03", today)).toEqual({ y: 2021, m: 3, monthKnown: true });
    expect(parseResumeDate("03/2021", today)).toEqual({ y: 2021, m: 3, monthKnown: true });
    expect(parseResumeDate("15/03/2021", today)).toEqual({ y: 2021, m: 3, monthKnown: true });
    expect(parseResumeDate("2018", today)).toEqual({ y: 2018, m: 1, monthKnown: false });
    expect(parseResumeDate("Present", today)).toBe("present");
    expect(parseResumeDate("till date", today)).toBe("present");
    expect(parseResumeDate(null, today)).toBeNull();
    expect(parseResumeDate("sometime", today)).toBe("unreadable");
  });

  it("understands the other formats seen in real resumes", () => {
    const jan20 = { y: 2020, m: 1, monthKnown: true };
    for (const d of ["Jan/2020", "Jan-2020", "Jan. 2020", "January,2020", "01-Jan-2020", "01-Jan.-2020", "15 January 2020", "Jan 15, 2020", "January 15th 2020", "Jan ‘2020", "Jan ’20"]) {
      expect(parseResumeDate(d, today), d).toEqual(jan20);
    }
    for (const d of ["Present day", "To present", "Currently working", "Till now", "current role"]) expect(parseResumeDate(d, today), d).toBe("present");
    expect(parseResumeDate("Spring 2020", today)).toBe("unreadable");
  });
});

describe("total experience", () => {
  it("adds months from start to end, both included, with Present as this month", () => {
    const r = calculateExperience([role("Jan 2020", "Dec 2021"), role("Jan 2022", "Present")], { today });
    expect(r.months).toBe(24 + 59); // Jan 2022 .. Nov 2026
    expect(r.flags).toEqual([]);
    expect(r.roles.map((x) => x.months)).toEqual([24, 59]);
    expect(shortExperience(r.months)).toBe("6y 11m");
    expect(formatExperience(r.months)).toBe("6 yrs 11 mos");
  });

  it("counts overlapping roles once and says so", () => {
    const r = calculateExperience([role("Jan 2020", "Dec 2022", "Developer", "A"), role("Jun 2022", "Dec 2023", "Lead", "B")], { today });
    expect(r.months).toBe(48); // Jan 2020 .. Dec 2023
    expect(kinds(r)).toEqual(["overlap"]);
  });

  it("flags a long gap between roles", () => {
    const r = calculateExperience([role("Jan 2018", "Dec 2019"), role("Jan 2021", "Dec 2021")], { today });
    expect(r.months).toBe(36);
    expect(r.flags[0]).toMatchObject({ kind: "gap", message: expect.stringContaining("1 yr") });
  });

  it("uses mid-year for year-only dates and marks the total as approximate", () => {
    const r = calculateExperience([role("2019", "2021")], { today });
    expect(r.months).toBe(24); // Jul 2019 .. Jun 2021
    expect(r).toMatchObject({ approximate: true });
    expect(r.flags).toEqual([]);
    expect(calculateExperience([role("2020", "2020")], { today }).months).toBe(6);
    expect(formatExperience(24, true)).toBe("about 2 yrs");
  });

  it("flags missing, unreadable, reversed and future dates and leaves those roles out", () => {
    const r = calculateExperience([
      role(null, "Dec 2020", "Analyst"), role("Jan 2021", null, "Consultant"), role("Mar 2022", "Jan 2022", "Manager"),
      role("Jan 2027", "Present", "Director"), role("soon", "later", "Intern"), role("Feb 2023", "Jan 2024", "Lead"),
    ], { today });
    expect(r.months).toBe(12);
    expect(kinds(r)).toEqual(["missing_dates", "missing_dates", "end_before_start", "future_date", "unreadable_date"]);
    expect(r.roles.map((x) => x.months)).toEqual([null, null, null, null, null, 12]);
  });

  it("compares with the total the resume states", () => {
    expect(kinds(calculateExperience([role("Jan 2022", "Dec 2023")], { statedYears: 8, today }))).toEqual(["stated_mismatch"]);
    // Close enough (or claiming less) isn't flagged.
    expect(calculateExperience([role("Jan 2022", "Dec 2023")], { statedYears: 3, today }).flags).toEqual([]);
    expect(calculateExperience([role("Jan 2020", "Dec 2023")], { statedYears: 2, today }).flags).toEqual([]);
  });

  it("returns nothing to show when no role has usable dates", () => {
    expect(calculateExperience([], { today })).toMatchObject({ months: null, flags: [] });
    expect(calculateExperience([role(null, null)], { today }).months).toBeNull();
  });
});
