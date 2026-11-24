import type { Role } from "@/lib/auth/permissions";

// Plain descriptions of each role for the team page and the invite dialog. They follow the permission
// table in permissions.ts; change both together.

export const ROLE_INFO: Record<Role, { label: string; summary: string; bestFor: string }> = {
  owner: {
    label: "Owner",
    summary: "Everything. The only role that can change company and interview settings and add or change Admins.",
    bestFor: "The account holder",
  },
  admin: {
    label: "Admin",
    summary: "Everything a Recruiter can do, plus billing, branding, privacy, the audit log, deleting data, and adding Recruiters, Interviewers and Viewers.",
    bestFor: "HR head or office manager",
  },
  recruiter: {
    label: "Recruiter",
    summary: "Creates jobs and templates, adds and invites candidates, reads reports, watches recordings, shortlists and hires. Sees every job; gets emails for the jobs they're on the hiring team of.",
    bestFor: "People who run hiring day to day",
  },
  interviewer: {
    label: "Interviewer",
    summary: "Works only on the jobs they're on the hiring team of: sees those jobs' candidates, interviews, reports and recordings, adds notes, and fills in scorecards for live rounds they're on. No salary details or decisions.",
    bestFor: "Team leads who join live rounds",
  },
  viewer: {
    label: "Viewer",
    summary: "Read only: the interview list and reports. Can't watch recordings or change anything.",
    bestFor: "Managers who just want to follow along",
  },
};

export const ROLE_ORDER: Role[] = ["owner", "admin", "recruiter", "interviewer", "viewer"];

/** What each role can do, for the comparison table. A string is a "yes, but…" note. */
export const ROLE_MATRIX: { label: string; can: Record<Role, boolean | string> }[] = [
  { label: "Jobs and interview templates", can: { owner: true, admin: true, recruiter: true, interviewer: false, viewer: false } },
  { label: "See and add candidates", can: { owner: true, admin: true, recruiter: true, interviewer: "See, on their jobs", viewer: false } },
  { label: "Which jobs", can: { owner: "All", admin: "All", recruiter: "All", interviewer: "Their jobs", viewer: "All" } },
  { label: "Salary details", can: { owner: true, admin: true, recruiter: true, interviewer: false, viewer: false } },
  { label: "Notes on candidates", can: { owner: true, admin: true, recruiter: true, interviewer: "Their jobs", viewer: false } },
  { label: "Invite candidates to interviews", can: { owner: true, admin: true, recruiter: true, interviewer: false, viewer: false } },
  { label: "Read interview reports", can: { owner: true, admin: true, recruiter: true, interviewer: "Their jobs", viewer: true } },
  { label: "Watch recordings", can: { owner: true, admin: true, recruiter: true, interviewer: "Their jobs", viewer: false } },
  { label: "Scorecards for live rounds", can: { owner: true, admin: true, recruiter: true, interviewer: "Own rounds", viewer: false } },
  { label: "Shortlist, hire and reject", can: { owner: true, admin: true, recruiter: true, interviewer: false, viewer: false } },
  { label: "Team members", can: { owner: true, admin: "Not Owners or Admins", recruiter: false, interviewer: false, viewer: false } },
  { label: "Billing and usage", can: { owner: true, admin: true, recruiter: false, interviewer: false, viewer: false } },
  { label: "Branding, privacy and audit log", can: { owner: true, admin: true, recruiter: false, interviewer: false, viewer: false } },
  { label: "Company and interview settings", can: { owner: true, admin: false, recruiter: false, interviewer: false, viewer: false } },
];
