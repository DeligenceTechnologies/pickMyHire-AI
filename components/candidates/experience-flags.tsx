"use client";

import { AlertTriangle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ExperienceFlag } from "@/lib/resume/experience";

/** The amber warning next to experience: hover (or focus) to see which resume dates need a look and why. */
export function ExperienceFlags({ flags }: { flags: ExperienceFlag[] }) {
  if (!flags.length) return null;
  return (
    <Tooltip>
      <TooltipTrigger delay={150} render={
        <button type="button" aria-label={`Experience needs a check: ${flags.map((f) => f.message).join("; ")}`}
          className="relative z-10 inline-flex cursor-help rounded-sm text-amber-500 outline-none hover:text-amber-600 focus-visible:ring-2 focus-visible:ring-amber-400" />
      }>
        <AlertTriangle className="size-3.5" aria-hidden />
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-80 flex-col items-start gap-1.5 px-3.5 py-3 text-left">
        <span className="font-semibold">Check the resume dates</span>
        <ul className="space-y-1">
          {flags.map((f) => <li key={f.message} className="flex gap-1.5"><span aria-hidden>•</span><span>{f.message}</span></li>)}
        </ul>
        <span className="text-[11px] opacity-70">Total experience is worked out from these dates, so it may be off.</span>
      </TooltipContent>
    </Tooltip>
  );
}
