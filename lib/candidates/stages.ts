// Interview stages on the Candidates page, grouped from the interview statuses the app already uses.
// Shared by the server (filters, counts) and the browser (job cards, chips, board).
import { CircleCheck, Clock3, PlayCircle, Send, UserRound } from "lucide-react";

export const STAGE_GROUPS = ["not_invited", "invited", "in_progress", "completed", "expired"] as const;
export type StageGroup = (typeof STAGE_GROUPS)[number];
export const STAGE_GROUP_LABEL: Record<StageGroup, string> = {
  not_invited: "Not invited", invited: "Invited", in_progress: "In progress", completed: "Completed", expired: "Expired",
};
export type StageCounts = Record<StageGroup, number>;
export const emptyStageCounts = (): StageCounts => ({ not_invited: 0, invited: 0, in_progress: 0, completed: 0, expired: 0 });

/** One colour and icon per stage. */
export const STAGE_STYLE: Record<StageGroup, { icon: typeof Send; dot: string; soft: string; text: string; ring: string; bar: string; glow: string; hint: string }> = {
  not_invited: { icon: UserRound, dot: "bg-slate-400", soft: "bg-slate-100 dark:bg-slate-800", text: "text-slate-700 dark:text-slate-300", ring: "ring-slate-400", bar: "bg-slate-400", glow: "shadow-slate-400/25", hint: "Added, no interview yet" },
  invited: { icon: Send, dot: "bg-sky-500", soft: "bg-sky-50 dark:bg-sky-950", text: "text-sky-700 dark:text-sky-300", ring: "ring-sky-500", bar: "bg-sky-500", glow: "shadow-sky-500/25", hint: "Link sent, not started" },
  in_progress: { icon: PlayCircle, dot: "bg-primary", soft: "bg-accent", text: "text-primary", ring: "ring-primary", bar: "bg-primary", glow: "shadow-primary/25", hint: "Taking it now" },
  completed: { icon: CircleCheck, dot: "bg-emerald-500", soft: "bg-emerald-50 dark:bg-emerald-950", text: "text-emerald-700 dark:text-emerald-300", ring: "ring-emerald-500", bar: "bg-emerald-500", glow: "shadow-emerald-500/25", hint: "Done, report ready" },
  expired: { icon: Clock3, dot: "bg-rose-400", soft: "bg-rose-50 dark:bg-rose-950", text: "text-rose-700 dark:text-rose-300", ring: "ring-rose-400", bar: "bg-rose-400", glow: "shadow-rose-400/25", hint: "Link ran out" },
};
