import { describe, expect, it } from "vitest";
import { describeOutcome, type OutcomeInput } from "@/lib/interview/outcome";

const start = new Date("2026-10-28T16:13:19Z");
const at = (s: number) => new Date(start.getTime() + s * 1000);
const fmt = (d: Date) => d.toISOString().slice(11, 19);
const sections = (statuses: string[]) => ["Introduction", "Experience", "Role Fit", "Candidate Questions"].map((name, i) => ({ name, status: statuses[i] }));
const base = (o: Partial<OutcomeInput>): OutcomeInput => ({
  status: "report_ready", startedAt: start, completedAt: null, durationSeconds: null, tokenExpiresAt: new Date("2026-11-04T11:00:00Z"),
  processingError: null, endReason: null, plannedMinutes: 26, sections: sections(["completed", "completed", "completed", "completed"]),
  events: [], lastSignalAt: null, issueReports: [], cancelledBy: null, ...o,
});

describe("how an interview ended", () => {
  it("explains an interview ended with the End button (Rohan's case)", () => {
    const o = describeOutcome(base({ endReason: "candidate_ended", durationSeconds: 876, sections: sections(["completed", "completed", "completed", "skipped"]) }), at(2000), fmt)!;
    expect(o.tone).toBe("warn");
    expect(o.title).toBe("Ended early by the candidate");
    expect(o.details).toEqual([
      "The candidate clicked End and confirmed “End the interview now?”. No connection problem forced it.",
      "Length: 14 min 36 s (planned about 26 min).",
      "3 of 4 sections completed; not reached: Candidate Questions.",
    ]);
  });

  it("explains an interview whose page stopped with no error (Khushi's case)", () => {
    const o = describeOutcome(base({
      status: "in_progress", sections: sections(["in_progress", "pending", "pending", "pending"]), lastSignalAt: at(37),
      events: [{ at: at(1), type: "session_started_client", payload: {} }, { at: at(6), type: "realtime_connected", payload: {} }],
    }), at(3600), fmt)!;
    expect(o.tone).toBe("warn");
    expect(o.title).toBe("Stopped 37 s into the interview");
    expect(o.details[0]).toBe("Nothing has arrived from the candidate's browser since 16:13:56.");
    expect(o.details[1]).toMatch(/tab or browser was closed, the computer slept, or the internet connection was lost/);
    expect(o.details).toContain("0 of 4 sections completed; not reached: Experience, Role Fit, Candidate Questions.");
    expect(o.details.join(" ")).toMatch(/link still works until .* continues where it stopped/);
    expect(o.problems).toEqual([]);
  });

  it("says when the voice connection dropped and never came back", () => {
    const o = describeOutcome(base({
      status: "in_progress", lastSignalAt: at(300),
      events: [{ at: at(100), type: "realtime_reconnecting", payload: {} }, { at: at(110), type: "realtime_reconnected", payload: { attempt: 0 } }, { at: at(290), type: "realtime_reconnecting", payload: {} }],
    }), at(3600), fmt)!;
    expect(o.tone).toBe("error");
    expect(o.details[1]).toMatch(/couldn't reconnect/);
    expect(o.problems.map((p) => [p.at, p.text])).toEqual([
      ["1:40", "The AI voice connection dropped; reconnecting (2 times)"],
      ["1:50", "Voice connection restored (attempt 1)"],
    ]);
  });

  it("is calm while the interview is running", () => {
    const o = describeOutcome(base({ status: "in_progress", lastSignalAt: at(60) }), at(90), fmt)!;
    expect(o).toMatchObject({ tone: "ok", title: "In progress now" });
  });

  it("shows a normal finish, the time limit, an automatic close and a failed report", () => {
    expect(describeOutcome(base({ endReason: "finished", durationSeconds: 1500 }), at(2000), fmt)).toMatchObject({ tone: "ok", title: "Finished normally" });
    expect(describeOutcome(base({ endReason: "time_limit" }), at(2000), fmt)).toMatchObject({ tone: "warn", title: "Ended at the time limit" });
    expect(describeOutcome(base({ endReason: "closed_by_processing" }), at(2000), fmt)).toMatchObject({ title: "Closed automatically" });
    const failed = describeOutcome(base({ status: "failed", endReason: "finished", processingError: "OpenAI timeout" }), at(2000), fmt)!;
    expect(failed.tone).toBe("error");
    expect(failed.details.at(-1)).toMatch(/report couldn't be generated: OpenAI timeout/);
  });

  it("lists problems with their time into the interview, and flags serious ones", () => {
    const o = describeOutcome(base({
      endReason: "finished",
      events: [
        { at: at(65), type: "speak_failed", payload: { message: "NotAllowedError" } },
        { at: at(10), type: "answer_submitted", payload: { chars: 300 } },
        { at: at(200), type: "mic_switched", payload: { reason: "device lost" } },
      ],
      issueReports: [{ at: at(400), category: "Audio or video problem" }],
    }), at(2000), fmt)!;
    expect(o.tone).toBe("warn");
    expect(o.problems).toEqual([
      { at: "1:05", text: "The interviewer's question couldn't be played: NotAllowedError", tone: "error" },
      { at: "3:20", text: "The microphone changed (device lost)", tone: "warn" },
      { at: "6:40", text: "The candidate reported an issue: Audio or video problem", tone: "warn" },
    ]);
  });

  it("covers interviews that never ran", () => {
    expect(describeOutcome(base({ status: "invited", startedAt: null }), at(0), fmt)).toBeNull();
    expect(describeOutcome(base({ status: "cancelled", startedAt: null, cancelledBy: "Priya" }), at(0), fmt)!.details[0]).toBe("Cancelled by Priya before the candidate started.");
    expect(describeOutcome(base({ status: "expired", startedAt: null }), at(0), fmt)!.title).toBe("The link expired");
  });
});
