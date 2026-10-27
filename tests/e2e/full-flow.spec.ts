import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

// End-to-end: recruiter signs up → creates job → invites candidate with resume →
// candidate consents, passes device check, completes the interview (demo AI mode,
// typed answers) → recruiter sees transcript and report.
// Requires the app running with AI_PROVIDER=mock or without OPENAI_API_KEY, and ffmpeg.

// The fake camera shows a face (the website's marketing photo) for 25 s, then an
// empty frame for 25 s, on a loop: the identity check takes its photo from the
// face and flags the moments with no one in view. (Y4M carries its frame rate.)
const camera = path.join(__dirname, "../../test-results/face-camera.y4m");
if (!existsSync(camera)) {
  mkdirSync(path.dirname(camera), { recursive: true });
  execFileSync("ffmpeg", ["-v", "error", "-y", "-loop", "1", "-t", "25", "-i", path.join(__dirname, "../../public/marketing/candidate-interview.jpg"),
    "-f", "lavfi", "-t", "25", "-i", "color=c=gray:s=320x240",
    "-filter_complex", "[0]scale=320:240,setsar=1,fps=5,format=yuv420p[a];[1]fps=5,setsar=1,format=yuv420p[b];[a][b]concat=n=2:v=1",
    "-pix_fmt", "yuv420p", camera]);
}
test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", `--use-file-for-fake-video-capture=${camera}`] } });

const LONG_ANSWER =
  "In my current role I personally owned the payments platform. I designed the webhook processing service in Node.js, " +
  "added idempotency keys to prevent duplicate charges, and worked with product to define retries. The hardest production issue " +
  "was a race condition during peak traffic, which I diagnosed with tracing and fixed by moving to a queue. Latency dropped forty percent.";

test("recruiter to candidate to report", async ({ page, browser }) => {
  const id = Date.now().toString(36);
  const email = `recruiter-${id}@e2e.test`;
  const candidateEmail = `candidate-${id}@e2e.test`;

  // 1. Sign up
  await page.goto("/signup?code=1");
  await page.getByLabel("Full name").fill("Casey Recruiter");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Company / workspace name").fill(`E2E Co ${id}`);
  await page.getByLabel("Access code").fill(process.env.SIGNUP_ACCESS_CODE ?? "");
  await page.getByLabel("Password").fill(`pw-${id}-${Math.random().toString(36).slice(2)}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // 2. Create job with the short screening template
  await page.goto("/jobs/new");
  await page.getByLabel("Job title").fill("Senior Full Stack Engineer");
  await page.getByLabel("Job description").fill("We need a senior engineer with 5+ years of React, Node.js and PostgreSQL experience. AWS is a plus.");
  await page.getByLabel("Required skills").fill("React");
  await page.getByLabel("Required skills").press("Enter");
  await page.getByLabel("Round 1 template").selectOption({ label: "Quick Screening (15 min) · 15 min" });
  await page.getByRole("button", { name: "Create job" }).click();
  await expect(page.getByRole("heading", { name: /Senior Full Stack Engineer/ })).toBeVisible();

  // 3. Invite a new candidate with a resume
  await page.getByRole("button", { name: "Invite candidate" }).click();
  await page.getByLabel("Full name").fill("Taylor Morgan");
  await page.getByRole("textbox", { name: "Email" }).fill(candidateEmail);
  await page.locator("#inv-file").setInputFiles(path.join(__dirname, "fixtures/resume.txt"));
  // The job's questions, filled in by the recruiter for a direct invite.
  await page.getByRole("dialog").getByLabel(/Expected CTC/).fill("18");
  await page.getByRole("dialog").getByLabel("Notice period").selectOption("30");
  await page.getByRole("button", { name: "Send invitation" }).click();
  const linkInput = page.locator("input[readonly]").first();
  await expect(linkInput).toHaveValue(/\/interview\//);
  const link = await linkInput.inputValue();
  await page.getByRole("button", { name: "Done" }).click();

  // 4. Candidate flow in a separate browser context (no recruiter cookies)
  const ctx = await browser.newContext({ permissions: ["camera", "microphone"] });
  const cand = await ctx.newPage();
  // Keep a handle on every camera/microphone track the page opens, to check they're all turned off on time.
  await cand.addInitScript(() => {
    const w = window as unknown as { __tracks: MediaStreamTrack[] };
    w.__tracks = [];
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => { const s = await gum(c); w.__tracks.push(...s.getTracks()); return s; };
    const clone = MediaStreamTrack.prototype.clone;
    MediaStreamTrack.prototype.clone = function () { const t = clone.call(this); w.__tracks.push(t); return t; };
  });
  const liveTracks = () => cand.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.filter((t) => t.readyState === "live").map((t) => t.kind));
  await cand.goto(link);
  await expect(cand.getByRole("heading", { name: /welcome/i })).toBeVisible();
  await cand.getByRole("link", { name: "Get started" }).click();
  await cand.getByRole("checkbox").click();
  await cand.getByRole("button", { name: /I agree/ }).click();
  await expect(cand).toHaveURL(/device-check/);
  // Headless Chromium's fake capture devices can stall on the very first request; warm them up.
  await cand.evaluate(async () => {
    try {
      const s = await Promise.race([navigator.mediaDevices.getUserMedia({ audio: true, video: true }), new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
      s?.getTracks().forEach((t) => t.stop());
    } catch { /* ignore */ }
  });
  await expect(cand.getByText(/We can hear you/)).toBeVisible({ timeout: 30_000 });
  await expect(cand.getByText("Test recording worked")).toBeVisible({ timeout: 20_000 });
  // Identity check (on by default for new jobs): the photo is taken automatically.
  await expect(cand.getByText(/Photo taken\. It's compared with you/)).toBeVisible({ timeout: 30_000 });
  if (process.env.E2E_SCREENSHOTS) await cand.screenshot({ path: "test-results/device-check.png" });
  await cand.getByRole("button", { name: "I heard it" }).click();
  await expect(cand.getByText(/being prepared/)).toBeHidden({ timeout: 60_000 });
  await cand.getByRole("button", { name: "Continue to interview" }).click();
  await expect(cand).toHaveURL(/session/);
  expect(await liveTracks()).toEqual([]); // the device check let go of the camera and microphone
  await cand.getByRole("button", { name: "Start interview" }).click();
  // After the closing line the candidate is told the interview is over while the video saves.
  // The camera and microphone are already off while the recording is still saving.
  const sawSavingScreen = cand.getByText("Interview complete").waitFor({ timeout: 200_000 }).then(async () => {
    if (process.env.E2E_SCREENSHOTS) await cand.screenshot({ path: "test-results/saving-screen.png" }).catch(() => {});
    return liveTracks().catch(() => ["page closed"]);
  }, () => ["no saving screen"]);

  for (let turn = 0; turn < 25; turn++) {
    const answer = cand.locator("#typed");
    await Promise.race([
      answer.waitFor({ state: "visible", timeout: 60_000 }),
      cand.waitForURL(/completed/, { timeout: 60_000 }),
    ]).catch(() => {});
    if (cand.url().includes("/completed")) break;
    if (turn === 1 && process.env.E2E_SCREENSHOTS) await cand.screenshot({ path: "test-results/candidate-session.png" });
    if (turn === 1) {
      // No answer at all: the interviewer nudges, shows a countdown, then moves on by itself.
      const question = await cand.getByText(/^(Question|Follow-up)$/).locator("xpath=following-sibling::p").first().textContent();
      await expect(cand.getByText(/Start speaking when you're ready/)).toBeVisible({ timeout: 30_000 });
      await expect(cand.getByText("No answer yet — moving to the next question.")).toBeVisible({ timeout: 30_000 });
      if (process.env.E2E_SCREENSHOTS) await cand.screenshot({ path: "test-results/no-answer-countdown.png" });
      await expect(cand.getByText(question!, { exact: true })).toBeHidden({ timeout: 30_000 });
      continue;
    }
    if (turn === 3) {
      // The microphone disconnects mid-interview: the session carries on with another one.
      await cand.evaluate(() => {
        const cam = [...document.querySelectorAll("video")].map((v) => v.srcObject).find((s): s is MediaStream => s instanceof MediaStream)!;
        const mic = cam.getAudioTracks()[0];
        mic.stop();
        mic.dispatchEvent(new Event("ended"));
      });
      await expect(cand.getByText(/Microphone switched to/)).toBeVisible({ timeout: 20_000 });
      if (process.env.E2E_SCREENSHOTS) await cand.screenshot({ path: "test-results/mic-switched.png" });
    }
    await answer.fill(LONG_ANSWER);
    await cand.getByRole("button", { name: "Done answering" }).click();
    await expect(answer).toBeHidden();
  }
  await expect(cand).toHaveURL(/completed/, { timeout: 120_000 });
  await expect(cand.getByRole("heading", { name: /Thank you/ })).toBeVisible();
  expect(await sawSavingScreen).toEqual([]);
  await ctx.close();

  // 5. Recruiter reviews transcript and report
  await page.goto("/interviews");
  await page.getByRole("link", { name: "Taylor Morgan" }).click();
  await expect(page.getByText("Report ready")).toBeVisible({ timeout: 90_000 });
  // The identity check: the reference photo is shown (and served only to signed-in recruiters).
  const identity = page.getByRole("region", { name: "Identity check" });
  await expect(identity).toBeVisible();
  // The empty frames were flagged, with a photo and a link to that moment in the video.
  await expect(identity.getByText("Needs review")).toBeVisible();
  await expect(identity.getByText("No face in view").first()).toBeVisible();
  const photo = identity.getByRole("img", { name: "Reference photo" });
  await expect(photo).toBeVisible();
  expect((await page.request.get((await photo.getAttribute("src"))!)).headers()["content-type"]).toBe("image/jpeg");
  if (process.env.E2E_SCREENSHOTS) await identity.screenshot({ path: "test-results/identity-check.png" });
  await page.getByRole("tab", { name: "Report" }).click();
  await expect(page.getByText("Candidate interview report")).toBeVisible();
  await expect(page.getByText(/not a hiring recommendation/)).toBeVisible();
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: "test-results/recruiter-report.png", fullPage: true });
  // Recording is stored and streams with Range support (needed for seeking).
  const interviewId = page.url().match(/interviews\/([0-9a-f-]{36})/)![1];
  const rec = await (await page.request.get(`/api/interviews/${interviewId}/recording`)).json();
  // The microphone switch continued the recording as a second part; both are stored.
  expect(rec.parts.length).toBeGreaterThanOrEqual(2);
  for (const part of rec.parts) expect((await page.request.get(part.url, { headers: { Range: "bytes=0-3" } })).status()).toBe(206);
  const head = await page.request.get(rec.parts[0].url, { headers: { Range: "bytes=0-3" } });
  expect(head.status()).toBe(206);
  expect(Buffer.from(await head.body()).toString("hex")).toBe("1a45dfa3"); // WebM/EBML magic
  const total = Number(head.headers()["content-range"].split("/")[1]);
  const tail = await page.request.get(rec.parts[0].url, { headers: { Range: `bytes=${total - 10}-` } });
  expect(tail.status()).toBe(206);
  expect((await tail.body()).length).toBe(10);
  // Evidence links can open the recording at a moment (?t= in milliseconds).
  await page.goto(`/interviews/${interviewId}/recording?t=5000`);
  await expect.poll(() => page.evaluate(() => document.querySelector("video")?.currentTime ?? 0), { timeout: 20_000 }).toBeGreaterThanOrEqual(4.5);
  await page.goto(`/interviews/${interviewId}`);
  await page.getByRole("tab", { name: "Transcript" }).click();
  await expect(page.getByText(LONG_ANSWER.slice(0, 40)).first()).toBeVisible();
  await page.getByRole("tab", { name: "Questions" }).click();
  await expect(page.getByText(/Question/).first()).toBeVisible();
});
