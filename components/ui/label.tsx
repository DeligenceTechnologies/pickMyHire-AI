"use client"

import * as React from "react"
import { cn } from "cn"
import { InfoTip } from "@/components/common/info-tip"

/**
 * `required` adds a red asterisk (screen readers get the input's own required state).
 * `info` adds an ⓘ after the label that explains the field in one line.
 */
function Label({ className, required, info, children, ...props }: React.ComponentProps<"label"> & { required?: boolean; info?: React.ReactNode }) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
      {required && <span aria-hidden="true" className="-ml-1.5 text-destructive">*</span>}
      {info && <InfoTip className={required ? "-ml-1" : "-ml-0.5"}>{info}</InfoTip>}
    </label>
  )
}

export { Label }
