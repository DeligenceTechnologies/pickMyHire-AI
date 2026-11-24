export const ROLES = ["owner", "admin", "recruiter", "interviewer", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | "org:manage"
  | "billing:manage"
  | "team:manage"
  | "job:write"
  | "candidate:view"
  | "candidate:write"
  | "template:write"
  | "interview:write"
  | "interview:view"
  | "report:view"
  | "report:regenerate"
  | "recording:view"
  | "data:delete"
  | "privacy:manage"
  | "audit:view"
  | "usage:view"
  | "branding:manage"
  /** Mark rounds Qualified / Not qualified and move candidates to Shortlisted, Hired… */
  | "decision:write"
  /** Fill in a scorecard for a human interview you're on the panel of. */
  | "scorecard:write"
  /** See every job. Without it (Interviewers) only the jobs whose hiring team you're on. */
  | "job:all"
  /** Salary details: current / expected pay, notice period, and pay answers on applications. */
  | "candidate:salary"
  /** Add notes and suggestions on a candidate (Interviewers: for their jobs). */
  | "note:write";

const MATRIX: Record<Role, Permission[]> = {
  owner: [
    "org:manage", "billing:manage", "team:manage", "job:write", "candidate:view", "candidate:write", "template:write",
    "interview:write", "interview:view", "report:view", "report:regenerate", "recording:view",
    "data:delete", "privacy:manage", "audit:view", "usage:view", "branding:manage", "decision:write", "scorecard:write",
    "job:all", "candidate:salary", "note:write",
  ],
  admin: [
    "billing:manage", "team:manage", "job:write", "candidate:view", "candidate:write", "template:write", "interview:write", "interview:view",
    "report:view", "report:regenerate", "recording:view", "data:delete", "privacy:manage", "audit:view", "usage:view", "branding:manage",
    "decision:write", "scorecard:write", "job:all", "candidate:salary", "note:write",
  ],
  recruiter: [
    "job:write", "candidate:view", "candidate:write", "template:write", "interview:write", "interview:view", "report:view",
    "report:regenerate", "recording:view", "decision:write", "scorecard:write", "job:all", "candidate:salary", "note:write",
  ],
  // Interviewers work only on the jobs whose hiring team they're on (see lib/auth/job-scope.ts).
  interviewer: ["interview:view", "report:view", "recording:view", "scorecard:write", "candidate:view", "note:write"],
  viewer: ["interview:view", "report:view", "job:all"],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role]?.includes(permission) ?? false;
}

/** Roles a member with `role` may assign to others. */
export function assignableRoles(role: Role): Role[] {
  if (role === "owner") return ["admin", "recruiter", "interviewer", "viewer"];
  if (role === "admin") return ["recruiter", "interviewer", "viewer"];
  return [];
}

export const roleLabel: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  recruiter: "Recruiter",
  interviewer: "Interviewer",
  viewer: "Viewer",
};
