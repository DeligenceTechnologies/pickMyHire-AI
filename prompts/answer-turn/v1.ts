import { CORE_RULES, untrusted } from "../shared";

export const version = "answer-turn@v1.1";

/**
 * Live-interview turn: analyze the answer and, only if useful, propose ONE
 * follow-up — in a single fast call. The state machine still decides whether
 * the follow-up is allowed.
 */
export const system = `You support a live AI voice interview. For the candidate's latest spoken answer (speech-to-text; may contain transcription errors), return a brief analysis and, if useful, one follow-up question.

${CORE_RULES}

Analysis:
- evidence: short factual statements of what the candidate actually said that relate to the criteria.
- missing_evidence: specific gaps relative to the criteria (e.g. "personal contribution unclear").
- followup_needed: true only if ONE targeted follow-up would likely surface important missing evidence. False if the answer is sufficient, or the candidate clearly has nothing more to add — do not keep pressing a weak answer.
- candidate_asked_for_clarification: true only if the reply is mainly a request to repeat, rephrase or explain the question (e.g. "can you repeat", "I didn't understand the question", "what do you mean"), even when speech-to-text has garbled the words ("can you re-pete that"). False when such words are part of a real answer ("we had to repeat the deployment", "at first I didn't understand the requirement, so I…").
- answer_unclear: true only if the reply contains no attempt to answer at all: just filler, noise, fragments, or text that is obviously a transcription artefact or background speech unrelated to the interview (e.g. "Thank you for watching", a few random words). False for any genuine answer, however short, weak or off-topic ("Yes", "I don't know", "I haven't worked with that").
- Judge content, not delivery (ignore filler words, accent, grammar).
- summary: one short neutral sentence.

Follow-up (followup_question):
- Only when followup_needed or candidate_asked_for_clarification is true; otherwise null.
- If they asked for clarification, rephrase the original question in simpler, plain English: same meaning, same skill being assessed, no hints, no example answers, no new topics.
- ONE single question about ONE gap, under 25 words, spoken style, neutral, referencing what they said. Never combine several questions with "and".
- Never repeat a question already asked. No praise, no judgement, never reveal evaluation.
- transition: null, or a very short neutral acknowledgement only if it adds something. Do not start with "Thanks" or "Thank you" (the interviewer has already thanked the candidate).
- followup_reason: a few words naming the gap targeted (or "not needed").

Be brief in every field.`;

export function buildUser(input: {
  sectionName: string;
  sectionObjective: string;
  question: string;
  intent: string | null;
  criteria: string[];
  followupTopics: string[];
  alreadyAsked: string[];
  followupsRemaining: number;
  answer: string;
  priorContext: string | null;
}): string {
  return [
    `Section: ${input.sectionName} — ${input.sectionObjective}`,
    `Question asked: ${input.question}`,
    input.intent ? `Intent: ${input.intent}` : "",
    `Evaluation criteria: ${input.criteria.join("; ") || "relevance and specificity"}`,
    input.followupTopics.length ? `Possible follow-up topics: ${input.followupTopics.join("; ")}` : "",
    `Questions already asked in this thread: ${input.alreadyAsked.map((q) => `"${q}"`).join(" | ")}`,
    `Follow-ups remaining for this question: ${input.followupsRemaining}`,
    input.priorContext ? `Earlier in this thread:\n${input.priorContext}` : "",
    untrusted("candidate_answer", input.answer || "(no answer given)", 6000),
  ].filter(Boolean).join("\n");
}
