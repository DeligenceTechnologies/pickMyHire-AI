/**
 * Filters for a job's applications list, shared by the list (in the browser) and the application
 * page (on the server), so the list, its counts and Previous / Next always agree.
 * The filters live in the page address (?match=strong_match&sort=match), so they survive opening an
 * application and coming back, a reload, or a shared link.
 */
import type { Fit } from "@/lib/application-form";
import { matchLevelLabel, type MatchLevel } from "@/lib/validation/ai-schemas";

export const MATCH_VALUES = ["strong_match", "good_match", "partial_match", "low_match", "insufficient_information"] as const;
export const FIT_VALUES = ["ok", "warn", "fail", "none"] as const;
export const STATUS_VALUES = ["new", "interview_invited", "declined"] as const;
export const SORT_VALUES = ["recent", "match"] as const;
/** Rows per page in the list (shared with the application page, which links back to the right page). */
export const APPLICATIONS_PAGE_SIZE = 20;

export type ApplicationFilters = {
  top: boolean; // good or strong on skills, and nothing outside the job's limits
  match: "" | (typeof MATCH_VALUES)[number];
  fit: "" | (typeof FIT_VALUES)[number];
  status: string;
  sort: (typeof SORT_VALUES)[number];
};

export const NO_FILTERS: ApplicationFilters = { top: false, match: "", fit: "", status: "", sort: "recent" };

type Params = URLSearchParams | Record<string, string | string[] | undefined>;
const get = (p: Params, k: string) => {
  const v = p instanceof URLSearchParams ? p.get(k) : p[k];
  return typeof v === "string" ? v : Array.isArray(v) ? v[0] ?? "" : "";
};
const pick = <T extends string>(v: string, allowed: readonly T[]): T | "" => (allowed as readonly string[]).includes(v) ? (v as T) : "";

/** Read filters from a URL; anything unknown is ignored, so a hand-edited link can't break the page. */
export function parseApplicationFilters(p: Params, statuses: readonly string[] = STATUS_VALUES): ApplicationFilters {
  return {
    top: get(p, "top") === "1",
    match: pick(get(p, "match"), MATCH_VALUES),
    fit: pick(get(p, "fit"), FIT_VALUES),
    status: statuses.includes(get(p, "status")) ? get(p, "status") : "",
    sort: pick(get(p, "sort"), SORT_VALUES) || "recent",
  };
}

/** The query string for these filters, with defaults left out ("" when nothing is filtered). */
export function applicationFiltersQuery(f: ApplicationFilters): string {
  const q = new URLSearchParams();
  if (f.top) q.set("top", "1");
  if (f.match) q.set("match", f.match);
  if (f.fit) q.set("fit", f.fit);
  if (f.status) q.set("status", f.status);
  if (f.sort !== "recent") q.set("sort", f.sort);
  return q.toString();
}

export const withQuery = (path: string, query: string) => (query ? `${path}?${query}` : path);

type Filterable = { id: string; status: string; match_level: string | null; fit: Pick<Fit, "level"> };
const ORDER: Record<string, number> = { strong_match: 5, good_match: 4, partial_match: 3, low_match: 2, insufficient_information: 1 };

export const isTopFit = (r: Filterable) =>
  (r.match_level === "strong_match" || r.match_level === "good_match") && (r.fit.level === "ok" || r.fit.level === "none");

export function matchesApplicationFilters(r: Filterable, f: ApplicationFilters) {
  return (!f.top || isTopFit(r)) && (!f.match || r.match_level === f.match) && (!f.fit || r.fit.level === f.fit) && (!f.status || r.status === f.status);
}

/**
 * The filtered, sorted list. `rows` must arrive newest first (as the database returns them);
 * sorting by AI match keeps newest first within each level (the sort is stable).
 * `keep` stays in the list even when it no longer matches (the application someone is looking at).
 */
export function filterApplications<T extends Filterable>(rows: T[], f: ApplicationFilters, keep?: string): T[] {
  const r = rows.filter((x) => x.id === keep || matchesApplicationFilters(x, f));
  return f.sort === "match" ? [...r].sort((a, b) => (ORDER[b.match_level ?? ""] ?? 0) - (ORDER[a.match_level ?? ""] ?? 0)) : r;
}

/** Plain words for the active filters, e.g. "Strong · Within limits · by AI match". Empty when none. */
export function describeApplicationFilters(f: ApplicationFilters, fitLabel: Record<string, string>, statusLabel: Record<string, string>): string {
  const parts: string[] = [];
  if (f.top) parts.push("Matches skills and limits");
  if (f.match) parts.push(matchLevelLabel[f.match as MatchLevel]);
  if (f.fit) parts.push(fitLabel[f.fit] ?? f.fit);
  if (f.status) parts.push(statusLabel[f.status] ?? f.status);
  if (f.sort === "match") parts.push("by AI match");
  return parts.join(" · ");
}
