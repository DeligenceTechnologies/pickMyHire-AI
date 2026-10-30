// Recognises when a candidate's reply is a request to hear the question again
// ("repeat") or to have it explained more simply ("clarify"), or is only filler
// or noise ("unclear"). English only.
//
// A reply counts as a request only when the request is the whole reply (allowing
// polite words around it), so a real answer that happens to contain "repeat"
// ("we had to repeat the deployment") is never mistaken for one. Anything this
// misses — for example a request garbled by speech-to-text — is caught by the AI
// on the server.

export type RequestKind = "repeat" | "clarify" | "unclear";

/** Repeats or rephrasings allowed per question before the interview carries on as normal. */
export const MAX_REPEATS = 2;

/** Longest reply (in words) that can still be only a request. */
const MAX_REQUEST_WORDS = 25;

const FILLER = new Set([
  "uh", "uhh", "um", "umm", "hmm", "hm", "mm", "mmm", "er", "erm", "ah", "ahh", "oh", "eh", "huh",
]);

// Polite or connecting words allowed before, between and after requests.
const POLITE = String.raw`(?:sorry|i'?m sorry|i am sorry|excuse me|pardon me|hello|hi|hey|okay|ok|so|well|actually|yeah|yes|sir|ma'?am|madam|please|kindly|again|and|but|thank you|thanks|just|one more time|once more|the question|that|it|for me)`;

const REPEAT = [
  String.raw`(?:can|could|would|will) you (?:please )?(?:repeat|say|ask|read)(?: (?:that|it|this|the question|your question|the last question|the last part))?(?: (?:again|once more|one more time))?`,
  String.raw`(?:please )?repeat(?: (?:that|it|this|the question|your question|the last question|the last part))?`,
  String.raw`(?:please )?(?:say|ask|read) (?:that|it|this|the question|your question) again`,
  String.raw`say again|come again|pardon|once more|one more time`,
  String.raw`i (?:did not|didn'?t|could not|couldn'?t|can'?t|cannot|did n't) (?:hear|catch|get)(?: (?:you|that|it|this|the question|your question|what you said))?(?: (?:properly|clearly|well|correctly))?`,
  String.raw`i (?:missed|lost) (?:that|it|the question|your question|you)`,
  String.raw`what (?:was|is|'?s) the question(?: again)?`,
  String.raw`(?:i'?m |i am )?(?:not able to|unable to) hear(?: you| that| the question)?(?: properly| clearly)?`,
  String.raw`your voice (?:was|is) (?:breaking|not clear|cutting)`,
];

const CLARIFY = [
  String.raw`i (?:did not|didn'?t|do not|don'?t|could not|couldn'?t|can'?t|cannot) (?:understand|follow)(?: (?:that|it|this|the question|your question|what you mean|what you are asking|what you're asking))?(?: (?:properly|clearly|well|fully|correctly))?`,
  String.raw`(?:i'?m |i am )?not (?:sure|clear) (?:what|about) (?:you mean|you are asking|you're asking|the question(?: is)?|that)`,
  String.raw`what do you mean(?: by (?:that|it|this))?`,
  String.raw`what (?:does|do) (?:that|this|it|you) mean`,
  String.raw`what (?:exactly )?are you asking(?: me)?`,
  String.raw`(?:can|could|would|will) you (?:please )?(?:explain|clarify|rephrase|simplify|elaborate)(?: (?:that|it|this|the question|your question|what you mean))?(?: (?:again|more simply|in simple words|in simpler words|in simple terms|in simpler terms|a bit|a little|a bit more|a little more))*`,
  String.raw`(?:please )?(?:explain|clarify|rephrase|simplify)(?: (?:that|it|this|the question|your question))?(?: (?:again|more simply|in simple words|in simpler words|in simple terms|in simpler terms))*`,
  String.raw`(?:the )?question (?:is|was) (?:not clear|unclear|confusing)`,
  String.raw`(?:that|it|this) (?:is|was) (?:not clear|unclear|confusing)`,
  String.raw`(?:i'?m |i am )?confused`,
];

const at = (pattern: string) => new RegExp(String.raw`^(?:${pattern})(?=\s|$)`);
const REPEAT_RE = REPEAT.map(at);
const CLARIFY_RE = CLARIFY.map(at);
const POLITE_RE = at(POLITE);

/** Lower-case, straighten quotes, drop punctuation and filler words. */
export function normalizeReply(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w.replace(/'/g, "")))
    .join(" ");
}

/**
 * "repeat" / "clarify" when the reply is only a request (in any order, with
 * polite words around it); "unclear" when it holds nothing but filler or noise;
 * null for anything else, which is treated as a normal answer.
 * A reply asking for both ("I didn't understand, can you repeat?") is "clarify".
 */
export function classifyReply(text: string): RequestKind | null {
  if (!text.trim()) return null; // silence is handled by the answer timers
  let rest = normalizeReply(text);
  if (!rest) return /[a-z]/i.test(text) ? "unclear" : null;
  if (rest.split(" ").length > MAX_REQUEST_WORDS) return null;
  let found: RequestKind | null = null;
  while (rest) {
    const clarify = CLARIFY_RE.map((r) => rest.match(r)?.[0]).find(Boolean);
    const repeat = clarify ? undefined : REPEAT_RE.map((r) => rest.match(r)?.[0]).find(Boolean);
    const polite = clarify || repeat ? undefined : rest.match(POLITE_RE)?.[0];
    const hit = clarify ?? repeat ?? polite;
    if (!hit) return null; // something else was said: a real answer
    if (clarify) found = "clarify";
    else if (repeat && found !== "clarify") found = "repeat";
    rest = rest.slice(hit.length).trim();
  }
  return found;
}

/** "Yes" / "yes please" / "sure", in reply to "Would you like me to repeat the question?". */
export function isYes(text: string): boolean {
  return /^(?:(?:yes|yeah|yep|yup|sure|okay|ok|please|of course|go ahead|alright|all right|that would help|kindly|sir|ma'?am|thank you|thanks)\s?)+$/.test(normalizeReply(text));
}
