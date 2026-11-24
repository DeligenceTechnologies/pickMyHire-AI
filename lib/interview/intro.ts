import { MAX_REPEATS } from "./repeat";

// The interviewer's introduction, played on the "Ready" screen before the interview starts, so the
// interview itself opens straight with the first question. Same words on screen and in the voice.

export function introLines(input: { firstName: string; interviewerName: string; jobTitle: string; companyName: string; minutes: number | null }): string[] {
  const n: number = MAX_REPEATS;
  const times = n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;
  return [
    `Hi ${input.firstName}, I'm ${input.interviewerName}, the AI interviewer for the ${input.jobTitle} role at ${input.companyName}.`,
    input.minutes ? `The interview takes about ${input.minutes} minutes.` : null,
    `Answer out loud. When you finish an answer, just pause, or select "Done answering".`,
    "I may take a few seconds to reply or move on, so please wait for me.",
    `If you'd like to hear a question again, or have it explained, just ask. You can do that ${times} for each question.`,
    `When you're ready, select "Start interview" and I'll ask the first question.`,
  ].filter((l): l is string => !!l);
}
