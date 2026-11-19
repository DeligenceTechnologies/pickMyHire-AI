import { inStageGroup, stageGroup, type JobStage, type StageGroup } from "@/lib/jobs/job-stages";

// The job page's candidate list filters, kept in the address so they survive opening a candidate and
// coming back, and shared with the candidate / application pages so Previous / Next walk the same list.

export const EXPERIENCE: [string, string, number, number][] = [
  ["", "Any experience", 0, Infinity], ["0-2", "Under 2 years", 0, 24], ["2-5", "2–5 years", 24, 60], ["5-8", "5–8 years", 60, 96], ["8+", "8+ years", 96, Infinity],
];
export const MATCHES: [string, string][] = [
  ["", "Any match"], ["strong_match", "Strong match"], ["good_match", "Good match"], ["partial_match", "Partial match"], ["low_match", "Low match"], ["insufficient_information", "Not enough info"],
];
export const SORTS = [["activity", "Recent activity"], ["applied", "Newest applied"], ["match", "Best match"], ["experience", "Most experience"]] as const;
export type JobListSort = (typeof SORTS)[number][0];
export const PAGE_SIZES = [5, 10, 25];
const MATCH_RANK: Record<string, number> = { strong_match: 5, good_match: 4, partial_match: 3, low_match: 2, insufficient_information: 1 };

export type JobListFilters = { stage: StageGroup | ""; q: string; exp: string; match: string; sort: JobListSort; page: number; size: number };
export const DEFAULT_FILTERS: JobListFilters = { stage: "", q: "", exp: "", match: "", sort: "activity", page: 1, size: 5 };

type Params = URLSearchParams | Record<string, string | string[] | undefined>;
const read = (p: Params, k: string) => {
  const v = p instanceof URLSearchParams ? p.get(k) : p[k];
  return (Array.isArray(v) ? v[0] : v) ?? "";
};

export function parseJobListFilters(p: Params): JobListFilters {
  // Older links used "invited" / "interviewing"; both are in the Interviewing group now.
  const raw = read(p, "stage");
  const stage = raw === "invited" || raw === "interviewing" ? "interview" : raw;
  const exp = read(p, "exp");
  const match = read(p, "match");
  const sort = read(p, "sort");
  const size = Number(read(p, "size"));
  return {
    stage: stageGroup(stage) ? (stage as StageGroup) : "",
    q: read(p, "q").slice(0, 100),
    exp: EXPERIENCE.some((e) => e[0] === exp) ? exp : "",
    match: MATCHES.some((m) => m[0] === match) ? match : "",
    sort: SORTS.some((s) => s[0] === sort) ? (sort as JobListSort) : "activity",
    page: Math.max(1, Math.floor(Number(read(p, "page"))) || 1),
    size: PAGE_SIZES.includes(size) ? size : 5,
  };
}

/** The filters as a query string, leaving out defaults. `withPage: false` drops the page (for the detail pages). */
export function jobListQuery(f: JobListFilters, withPage = true): string {
  const q = new URLSearchParams();
  if (f.stage) q.set("stage", f.stage);
  if (f.q) q.set("q", f.q);
  if (f.exp) q.set("exp", f.exp);
  if (f.match) q.set("match", f.match);
  if (f.sort !== "activity") q.set("sort", f.sort);
  if (f.size !== 5) q.set("size", String(f.size));
  if (withPage && f.page > 1) q.set("page", String(f.page));
  return q.toString();
}

export const filtersOn = (f: JobListFilters) => !!(f.q || f.exp || f.match);

type ListRow = {
  id: string; name: string; email: string; stage: JobStage; match_level: string | null; experience_months: number | null;
  added_at: Date | string; last_activity: Date | string;
};

/** The rows the list shows, in its order. */
export function filterJobList<T extends ListRow>(rows: T[], f: JobListFilters): T[] {
  const needle = f.q.trim().toLowerCase();
  const range = EXPERIENCE.find((e) => e[0] === f.exp) ?? EXPERIENCE[0];
  const time = (d: Date | string) => new Date(d).getTime();
  const out = rows.filter((r) => (f.stage ? inStageGroup(f.stage, r.stage) : r.stage !== "rejected")
    && (!needle || r.name.toLowerCase().includes(needle) || r.email.toLowerCase().includes(needle))
    && (!f.match || r.match_level === f.match)
    && (!f.exp || (r.experience_months !== null && r.experience_months >= range[2] && r.experience_months < range[3])));
  return out.sort(f.sort === "applied" ? (a, b) => time(b.added_at) - time(a.added_at)
    : f.sort === "match" ? (a, b) => (MATCH_RANK[b.match_level ?? ""] ?? 0) - (MATCH_RANK[a.match_level ?? ""] ?? 0) || time(b.last_activity) - time(a.last_activity)
    : f.sort === "experience" ? (a, b) => (b.experience_months ?? -1) - (a.experience_months ?? -1)
    : (a, b) => time(b.last_activity) - time(a.last_activity));
}

/** Where a row opens: a new application opens the application (screening and answers); anyone else, their profile. */
export function jobRowHref(jobId: string, r: { id: string; application_id: string | null; application_status: string | null }, query: string) {
  const base = r.application_status === "new" && r.application_id ? `/jobs/${jobId}/applications/${r.application_id}` : `/candidates/${r.id}`;
  const q = new URLSearchParams(query);
  q.set("job", jobId);
  return `${base}?${q}`;
}

/** "Ready to review · Strong match · 2–5 years" for the Previous / Next bar. */
export function describeJobList(f: JobListFilters) {
  return [
    f.stage ? stageGroup(f.stage)?.label : "All active",
    f.q && `“${f.q}”`,
    f.match && MATCHES.find((m) => m[0] === f.match)?.[1],
    f.exp && EXPERIENCE.find((e) => e[0] === f.exp)?.[1],
  ].filter(Boolean).join(" · ");
}
