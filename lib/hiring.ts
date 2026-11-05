// Hiring decisions and human-interview labels, shared by server and client.

export const DECISIONS = ["qualified", "not_qualified", "on_hold"] as const;
export type Decision = (typeof DECISIONS)[number];
export const DECISION_LABEL: Record<Decision, string> = { qualified: "Qualified", not_qualified: "Not qualified", on_hold: "On hold" };

export const STAGES = ["in_progress", "shortlisted", "hired", "rejected", "withdrawn"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  in_progress: "In progress", shortlisted: "Shortlisted", hired: "Hired", rejected: "Rejected", withdrawn: "Withdrawn",
};

export const HUMAN_STATUSES = ["scheduled", "completed", "cancelled", "no_show"] as const;
export type HumanStatus = (typeof HUMAN_STATUSES)[number];
export const HUMAN_STATUS_LABEL: Record<HumanStatus, string> = { scheduled: "Scheduled", completed: "Completed", cancelled: "Cancelled", no_show: "No-show" };

export const LOCATION_TYPES = ["video", "phone", "in_person"] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];
export const LOCATION_LABEL: Record<LocationType, string> = { video: "Video call", phone: "Phone call", in_person: "In person" };

/** The detail each kind of interview needs, as asked for in the schedule form. */
export const LOCATION_FIELD: Record<LocationType, { label: string; placeholder: string; hint: string }> = {
  video: { label: "Meeting link", placeholder: "https://meet.google.com/abc-defg-hij", hint: "Zoom, Google Meet, Teams or any other video link." },
  phone: { label: "Phone number", placeholder: "+91 98765 43210", hint: "The number the candidate should call, or the number you'll call them on. Include the country code." },
  in_person: { label: "Address", placeholder: "4th floor, 12 MG Road, Pune 411001", hint: "Where the candidate should come, with floor or room if it helps." },
};

const PHONE = /^\+?[\d\s().-]+(?:\s*(?:ext\.?|x)\s*\d{1,6})?$/i;

/**
 * Check the meeting link, phone number or address for an interview (form and server use the same rule).
 * A link typed without "https://" is accepted and returned with it.
 */
export function checkLocation(type: LocationType, raw: string | null | undefined): { value: string; error?: undefined } | { error: string; value?: undefined } {
  const v = (raw ?? "").trim();
  if (type === "video") {
    if (!v) return { error: "Add the meeting link for this video call." };
    const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(v) ? v : `https://${v}`;
    try {
      const u = new URL(withScheme);
      if ((u.protocol === "https:" || u.protocol === "http:") && /^[^\s.]+(\.[^\s.]+)+$/.test(u.hostname) && !/\s/.test(v)) return { value: withScheme };
    } catch { /* not a link */ }
    return { error: "Enter a valid meeting link, e.g. https://meet.google.com/abc-defg-hij" };
  }
  if (type === "phone") {
    if (!v) return { error: "Add the phone number for this phone call." };
    const main = v.split(/\s*(?:ext\.?|x)\s*\d/i)[0];
    const digits = main.replace(/\D/g, "").length;
    if (!PHONE.test(v) || digits < 7 || digits > 15) return { error: "Enter a valid phone number, e.g. +91 98765 43210" };
    return { value: v };
  }
  if (!v) return { error: "Add the address for this in-person interview." };
  if (v.length < 5 || !/\p{L}/u.test(v)) return { error: "Enter the full address, e.g. 4th floor, 12 MG Road, Pune." };
  return { value: v };
}

export const DEFAULT_CRITERIA = ["Technical skills", "Problem solving", "Communication", "Culture and values fit"];
export const MAX_CRITERIA = 12;

/** "Tue 21 Oct, 3:00 PM IST" in the interview's own time zone (servers run in UTC). */
export function formatInZone(date: Date | string, timeZone: string, opts: { withZone?: boolean; withYear?: boolean } = {}) {
  const d = typeof date === "string" ? new Date(date) : date;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short", day: "numeric", month: "short", ...(opts.withYear ? { year: "numeric" } : {}),
      hour: "numeric", minute: "2-digit", hour12: true, timeZone, ...(opts.withZone !== false ? { timeZoneName: "short" } : {}),
    }).format(d);
  } catch {
    return d.toUTCString();
  }
}

/** Offset of `timeZone` from UTC at `utcMs`, in ms (e.g. +5:30 for Asia/Kolkata). */
function zoneOffset(utcMs: number, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** "2026-10-21" + "15:00" in Asia/Kolkata → the exact instant (ISO, UTC). */
export function zonedToUtc(date: string, time: string, timeZone: string) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let utc = wall - zoneOffset(wall, timeZone);
  utc = wall - zoneOffset(utc, timeZone); // second pass settles daylight-saving edges
  return new Date(utc).toISOString();
}

/** The date ("YYYY-MM-DD") and time ("HH:MM") of an instant, as seen in `timeZone`. */
export function utcToZoned(iso: string | Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
