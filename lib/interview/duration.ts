// How long an interview usually takes, as a range: the real length depends on the candidate's answers
// (short answers finish early; each part also has a time limit), so a single number like "26 minutes"
// promises too much. Used in the spoken intro, the welcome page and the invite email.

const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);

/** 26 → { low: 20, high: 30 }; null when the planned length isn't known. */
export function durationRange(minutes: number | null | undefined): { low: number; high: number } | null {
  if (!minutes || minutes <= 0) return null;
  const low = round5(minutes * 0.75);
  const high = Math.max(round5(minutes * 1.15), low + 5);
  return { low, high };
}

/** "20 to 30 minutes" (spoken) or "20–30 minutes" (written). */
export function durationText(minutes: number | null | undefined, style: "spoken" | "written" = "written"): string | null {
  const r = durationRange(minutes);
  return r ? `${r.low}${style === "spoken" ? " to " : "–"}${r.high} minutes` : null;
}
