import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";

// `npm run db:seed` — fills the database with demo data through the running app.
// The app must run with AI_PROVIDER=mock (typed answers, no OpenAI cost).
for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);

// The fake camera shows a face photo, so the identity check and the video look real.
const camera = path.join(__dirname, "face-camera.mjpeg");

export default defineConfig({
  testDir: __dirname,
  testMatch: "demo-data.spec.ts",
  timeout: 30 * 60_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    launchOptions: {
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", `--use-file-for-fake-video-capture=${camera}`],
    },
  },
  // Uses the installed Google Chrome, so no browser download is needed.
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome", permissions: ["camera", "microphone"] } }],
});
