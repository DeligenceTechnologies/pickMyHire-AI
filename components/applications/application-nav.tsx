"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Previous / Next through the filtered applications list without going back to it.
 * Keys: J or → next, K or ← previous, Esc back to the list (ignored while typing or in a dialog).
 */
export function ApplicationNav({ prevHref, nextHref, listHref, position, total, label, inList }: {
  prevHref: string | null; nextHref: string | null; listHref: string;
  position: number; total: number; label: string; inList: boolean;
}) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (document.querySelector("[role='dialog'], [role='alertdialog'], [role='menu']")) return;
      const k = e.key.toLowerCase();
      if ((k === "j" || k === "arrowright") && nextHref) { e.preventDefault(); router.push(nextHref); }
      else if ((k === "k" || k === "arrowleft") && prevHref) { e.preventDefault(); router.push(prevHref); }
      else if (k === "escape") { e.preventDefault(); router.push(listHref); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, prevHref, nextHref, listHref]);

  const nav = cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1");
  const off = cn(nav, "pointer-events-none opacity-50");
  return (
    <nav aria-label="Applications in this list" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-2.5 text-sm">
      <p className="text-muted-foreground">
        {inList
          ? <><span className="font-medium text-foreground tabular">{position} of {total}</span> {total === 1 ? "application" : "applications"}</>
          : <><span className="font-medium text-foreground">No longer in this list</span> · {total} {total === 1 ? "application" : "applications"}</>}
        {label && <> · {label}</>}
      </p>
      <div className="flex items-center gap-2">
        <span className="hidden text-xs text-muted-foreground md:inline">Keys: K / J</span>
        {prevHref
          ? <Link href={prevHref} className={nav} aria-keyshortcuts="K"><ChevronLeft className="size-4" /> Previous</Link>
          : <span className={off} aria-disabled="true"><ChevronLeft className="size-4" /> Previous</span>}
        {nextHref
          ? <Link href={nextHref} className={nav} aria-keyshortcuts="J">Next <ChevronRight className="size-4" /></Link>
          : <span className={off} aria-disabled="true">Next <ChevronRight className="size-4" /></span>}
      </div>
    </nav>
  );
}
