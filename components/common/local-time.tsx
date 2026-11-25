"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};
const OPTIONS: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
const WITH_TIME: Intl.DateTimeFormatOptions = { ...OPTIONS, hour: "numeric", minute: "2-digit" };

/**
 * A date and time in the viewer's own time zone. Pages are first drawn on the server, whose clock is
 * UTC on the live site, so a time formatted there would be hours off for most people (and differ from
 * the same time drawn in the browser). The first draw uses UTC on both sides (so the browser takes over
 * the server's HTML cleanly), then it switches to the viewer's local time straight away.
 */
export function LocalTime({ date, withTime = true, className }: { date: Date | string | null | undefined; withTime?: boolean; className?: string }) {
  const inBrowser = useSyncExternalStore(noop, () => true, () => false);
  if (!date) return <span className={className}>—</span>;
  const d = typeof date === "string" ? new Date(date) : date;
  const opts = withTime ? WITH_TIME : OPTIONS;
  const text = inBrowser ? d.toLocaleString("en-US", opts) : d.toLocaleString("en-US", { ...opts, timeZone: "UTC" });
  return <time dateTime={d.toISOString()} className={className}>{text}</time>;
}
