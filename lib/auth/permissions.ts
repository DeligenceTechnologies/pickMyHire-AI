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
  | "scorecard:write";

const MATRIX: Record<Role, Permission[]> = {
  owner: [
    "org:manage", "billing:manage", "team:manage", "job:write", "candidate:view", "candidate:write", "template:write",
    "interview:write", "interview:view", "report:view", "report:regenerate", "recording:view",
    "data:delete", "privacy:manage", "audit:view", "usage:view", "branding:manage", "decision:write", "scorecard:write",
  ],
  admin: [
    "billing:manage", "team:manage", "job:write", "candidate:view", "candidate:write", "template:write", "interview:write", "interview:view",
    "report:view", "report:regenerate", "recording:view", "data:delete", "privacy:manage", "audit:view", "usage:view", "branding:manage",
    "decision:write", "scorecard:write",
  ],
  recruiter: [
    "job:write", "candidate:view", "candidate:write", "template:write", "interview:write", "interview:view", "report:view",
    "report:regenerate", "recording:view", "decision:write", "scorecard:write",
  ],
  interviewer: ["interview:view", "report:view", "recording:view", "scorecard:write"],
  viewer: ["interview:view", "report:view"],
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
