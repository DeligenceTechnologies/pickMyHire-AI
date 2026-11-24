"use client";

import { Popover } from "@base-ui/react/popover";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A small ⓘ next to a field label that explains the field in one line.
 * Opens on hover on a computer and on tap on a phone (a tooltip wouldn't open on touch).
 */
export function InfoTip({ children, label = "What is this?", className }: { children: React.ReactNode; label?: string; className?: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={100}
        render={
          <button type="button" aria-label={label}
            className={cn("inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", className)} />
        }
      >
        <Info className="size-3.5" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={6} className="isolate z-50">
          <Popover.Popup className="max-w-72 rounded-md bg-foreground px-3 py-2 text-xs leading-relaxed font-normal text-background shadow-md outline-none data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0">
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

