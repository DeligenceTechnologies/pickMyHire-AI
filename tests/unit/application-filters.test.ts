import { describe, expect, it } from "vitest";
import {
  applicationFiltersQuery, describeApplicationFilters, filterApplications, NO_FILTERS, parseApplicationFilters, withQuery,
} from "@/lib/applications/filters";

const row = (id: string, match_level: string | null, status = "new", fit: "ok" | "warn" | "fail" | "none" = "none") =>
  ({ id, match_level, status, fit: { level: fit } });

// Newest first, as the database returns them.
const rows = [
  row("a", "good_match", "new", "ok"),
  row("b", "strong_match", "interview_invited", "fail"),
  row("c", "low_match"),
  row("d", "strong_match", "new", "ok"),
  row("e", null, "new"),
  row("f", "good_match", "declined", "warn"),
];

describe("application filters in the URL", () => {
  it("round-trips through the query string, leaving defaults out", () => {
    const f = { ...NO_FILTERS, top: true, match: "strong_match" as const, fit: "ok" as const, status: "new", sort: "match" as const };
    const q = applicationFiltersQuery(f);
    expect(q).toBe("top=1&match=strong_match&fit=ok&status=new&sort=match");
    expect(parseApplicationFilters(new URLSearchParams(q))).toEqual(f);
    expect(applicationFiltersQuery(NO_FILTERS)).toBe("");
  });

  it("ignores unknown or hand-edited values", () => {
    expect(parseApplicationFilters({ match: "amazing", fit: "x", status: "hired", sort: "random", top: "yes" })).toEqual(NO_FILTERS);
    expect(parseApplicationFilters({ match: ["good_match", "strong_match"] }).match).toBe("good_match");
  });

  it("builds links with or without a query", () => {
    expect(withQuery("/jobs/1", "")).toBe("/jobs/1");
    expect(withQuery("/jobs/1", "match=good_match")).toBe("/jobs/1?match=good_match");
  });
});

describe("filtering and order", () => {
  const ids = (r: { id: string }[]) => r.map((x) => x.id);

  it("filters by AI match and keeps newest first", () => {
    expect(ids(filterApplications(rows, { ...NO_FILTERS, match: "strong_match" }))).toEqual(["b", "d"]);
  });

  it("'matches skills and limits' = good or strong and not outside limits", () => {
    expect(ids(filterApplications(rows, { ...NO_FILTERS, top: true }))).toEqual(["a", "d"]);
  });

  it("combines filters", () => {
    expect(ids(filterApplications(rows, { ...NO_FILTERS, match: "good_match", status: "new" }))).toEqual(["a"]);
    expect(ids(filterApplications(rows, { ...NO_FILTERS, fit: "none" }))).toEqual(["c", "e"]);
  });

  it("sorts by AI match, newest first within a level (stable)", () => {
    expect(ids(filterApplications(rows, { ...NO_FILTERS, sort: "match" }))).toEqual(["b", "d", "a", "f", "c", "e"]);
  });

  it("keeps the application being viewed in its place even when it no longer matches", () => {
    // b was invited, so a 'new only' filter would drop it; Previous/Next must still work from it.
    expect(ids(filterApplications(rows, { ...NO_FILTERS, status: "new" }, "b"))).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("plain-words label", () => {
  it("names the active filters", () => {
    const label = describeApplicationFilters({ ...NO_FILTERS, match: "strong_match", sort: "match" }, { ok: "Fits limits" }, { new: "New" });
    expect(label).toBe("Strong match · by AI match");
    expect(describeApplicationFilters(NO_FILTERS, {}, {})).toBe("");
  });
});
