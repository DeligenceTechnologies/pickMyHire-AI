// "I don't know" / "skip": the candidate chose not to answer. The interviewer moves on kindly, with no
// follow-up on that question, so nobody feels pushed to guess. Only short replies count: "I don't know
// the exact number, but we cut costs by half…" is an answer.

const SKIP = [
  /\bi\s*(do\s*not|don'?t|dont)\s*(really\s*)?know\b/,
  /\bno\s*idea\b/,
  /\bi\s*(am\s*not|'?m\s*not)\s*sure\b/,
  /\bnot\s*sure\b/,
  /\bi\s*(can'?t|cannot)\s*answer\b/,
  /\bi\s*(have\s*not|haven'?t)\s*(worked|done|used|tried)\b/,
  /\bi\s*(would|'d)\s*like\s*to\s*skip\b/,
  /\b(skip|pass)(\s*(this|that|it|the\s*question))?\b/,
  /\b(next|move\s*on\s*to\s*the\s*next)\s*question\b/,
  /\blet'?s\s*move\s*on\b/,
];
const MAX_WORDS = 14;

export const SKIP_LINE = "No problem, let's move on.";

export function isSkipReply(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t || t.split(" ").length > MAX_WORDS) return false;
  return SKIP.some((re) => re.test(t));
}
