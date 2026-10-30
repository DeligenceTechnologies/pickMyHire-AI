import { describe, expect, it } from "vitest";
import { classifyReply, isYes } from "@/lib/interview/repeat";

describe("repeat and clarify requests", () => {
  it.each([
    "Can you repeat the question?",
    "Sorry, could you please repeat that?",
    "Repeat.",
    "Please repeat the question.",
    "Sorry, I didn't hear you. Can you say that again?",
    "I couldn't hear the question properly.",
    "Pardon?",
    "Come again?",
    "Um, one more time please.",
    "What was the question again?",
    "Hello? Sorry, I missed that.",
    "Could you ask that again, please?",
    "Sorry, your voice was breaking. Can you repeat?",
    "Can you please repeat the question, ma'am?",
  ])("repeats for %s", (text) => {
    expect(classifyReply(text)).toBe("repeat");
  });

  it.each([
    "I didn't understand the question.",
    "Sorry, I don't understand. Can you repeat?",
    "What do you mean?",
    "Can you explain the question?",
    "Could you rephrase that in simpler words?",
    "I'm not sure what you are asking.",
    "The question is not clear.",
    "Sorry, I'm confused.",
    "What does that mean?",
  ])("rephrases for %s", (text) => {
    expect(classifyReply(text)).toBe("clarify");
  });

  it("treats filler-only replies as unclear", () => {
    expect(classifyReply("Uh... hmm.")).toBe("unclear");
    expect(classifyReply("Umm")).toBe("unclear");
  });

  it.each([
    "We had to repeat the deployment twice because the migration failed.",
    "I repeat the tests every night before release.",
    "Yes.",
    "Okay, thank you.",
    "I didn't understand the requirement at first, so I asked the client for examples and then rebuilt the flow.",
    "What do you mean by scale is something I asked my manager early on, and we agreed on targets.",
    "Pardon my English, I worked on React for five years.",
    "",
    "   ",
  ])("treats a real answer as an answer: %s", (text) => {
    expect(classifyReply(text)).toBeNull();
  });

  it("recognises yes in reply to the repeat offer", () => {
    expect(isYes("Yes please.")).toBe(true);
    expect(isYes("Yeah, sure.")).toBe(true);
    expect(isYes("Okay.")).toBe(true);
    expect(isYes("Yes, I led the migration project.")).toBe(false);
    expect(isYes("No, I'm ready.")).toBe(false);
  });
});
