"use client";

import { useSyncExternalStore } from "react";
import { AlertTriangle, CheckCircle2, CircleAlert, Info } from "lucide-react";
import { describeOutcome, type Outcome, type OutcomeInput, type OutcomeTone } from "@/lib/interview/outcome";
import { cn } from "@/lib/utils";

const fmt = (d: Date) => d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
const TONE: Record<OutcomeTone, { box: string; icon: typeof Info; iconClass: string }> = {
  ok: { box: "border bg-card", icon: CheckCircle2, iconClass: "text-emerald-600" },
  warn: { box: "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40", icon: AlertTriangle, iconClass: "text-amber-600" },
  error: { box: "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40", icon: CircleAlert, iconClass: "text-red-600" },
};

const noop = () => () => {};
/** Worked out in the browser only, so times show in the viewer's own time zone. */
export function useOutcome(input: OutcomeInput | null): Outcome | null {
  const inBrowser = useSyncExternalStore(noop, () => true, () => false);
  return input && inBrowser ? describeOutcome(input, new Date(), fmt) : null;
}

/** "How the interview ended": why it ended or stopped, plus problems logged along the way. */
export function OutcomeCard({ outcome }: { outcome: Outcome }) {
  const t = TONE[outcome.tone];
  const Icon = t.icon;
  return (
    <section id="interview-outcome" aria-label="How the interview ended" className={cn("scroll-mt-24 rounded-xl p-5", t.box)}>
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">How the interview ended</p>
      <h2 className="mt-1 flex items-center gap-2 font-semibold"><Icon className={cn("size-5 shrink-0", t.iconClass)} />{outcome.title}</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {outcome.details.map((d) => <li key={d}>{d}</li>)}
      </ul>
      {outcome.problems.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-medium">Problems logged during the interview</p>
          <ul className="mt-1.5 space-y-1 text-sm">
            {outcome.problems.map((p) => (
              <li key={`${p.at}-${p.text}`} className="flex gap-3">
                <span className="w-12 shrink-0 font-mono text-xs leading-5 text-muted-foreground tabular">{p.at}</span>
                <span className={cn(p.tone === "error" && "font-medium text-red-700 dark:text-red-400", p.tone === "ok" && "text-muted-foreground")}>{p.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** One line at the top of the overview when something went wrong, pointing to the card. */
export function OutcomeAlert({ outcome }: { outcome: Outcome }) {
  if (outcome.tone === "ok") return null;
  const t = TONE[outcome.tone];
  const Icon = t.icon;
  return (
    <a href="#interview-outcome" className={cn("flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium hover:underline", t.box)}>
      <Icon className={cn("size-4 shrink-0", t.iconClass)} />{outcome.title}<span className="font-normal text-muted-foreground">· see how the interview ended below</span>
    </a>
  );
}
