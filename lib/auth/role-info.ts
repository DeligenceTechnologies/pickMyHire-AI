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
    summary: "Creates jobs and templates, adds and invites candidates, reads reports, watches recordings, shortlists and hires.",
    bestFor: "People who run hiring day to day",
  },
  interviewer: {
    label: "Interviewer",
    summary: "Sees interviews, reports and recordings, and fills in scorecards for live rounds they're on. Can't see the candidate list or make decisions.",
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
  { label: "See and add candidates", can: { owner: true, admin: true, recruiter: true, interviewer: false, viewer: false } },
  { label: "Invite candidates to interviews", can: { owner: true, admin: true, recruiter: true, interviewer: false, viewer: false } },
  { label: "Read interview reports", can: { owner: true, admin: true, recruiter: true, interviewer: true, viewer: true } },
  { label: "Watch recordings", can: { owner: true, admin: true, recruiter: true, interviewer: true, viewer: false } },
  { label: "Scorecards for live rounds", can: { owner: true, admin: true, recruiter: true, interviewer: "Own rounds", viewer: false } },
  { label: "Shortlist, hire and reject", can: { owner: true, admin: true, recruiter: true, interviewer: false, viewer: false } },
  { label: "Team members", can: { owner: true, admin: "Not Owners or Admins", recruiter: false, interviewer: false, viewer: false } },
  { label: "Billing and usage", can: { owner: true, admin: true, recruiter: false, interviewer: false, viewer: false } },
  { label: "Branding, privacy and audit log", can: { owner: true, admin: true, recruiter: false, interviewer: false, viewer: false } },
  { label: "Company and interview settings", can: { owner: true, admin: false, recruiter: false, interviewer: false, viewer: false } },
];
