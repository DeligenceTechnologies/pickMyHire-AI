# PickMyHire.ai — developer guide

Technical notes for engineers working on the platform. For what the product does, see the [README](../README.md).

Recruiters create jobs, invite candidates to personalized AI video interviews, and review evidence-backed reports. Every assessment links to timestamped transcript moments and the recording.

**Principle:** the LLM handles language (parsing, question wording, analysis, summaries). The application owns interview state, timing, limits, persistence, permissions and security (see `lib/interview/state-machine.ts`). No AI output ever produces a hire/reject decision.

## Quick start (local)

Prerequisites: Node 20.9+ and PostgreSQL 14+. This machine uses Homebrew `postgresql@16`.

```bash
npm install
cp .env.example .env.local       # then fill DATABASE_URL and APP_SECRET (see below)
npm run db:migrate
npm run dev                      # http://localhost:3000
```

`.env.local` for local development is already created in this folder: it has a dedicated **non-superuser** database role, because superusers bypass Row Level Security.

### Enabling live AI

Without `OPENAI_API_KEY`, the app runs in **demo mode**. Deterministic heuristics stand in for AI, the interviewer uses the browser's speech synthesis, and candidates type their answers. Demo output is clearly labeled everywhere it appears.

To enable OpenAI:

1. Put your key in `.env.local`: `OPENAI_API_KEY=sk-...`
2. Restart `npm run dev`.

Models are centralized in `lib/ai/config.ts` and can be overridden with `OPENAI_MODEL_FAST`, `OPENAI_MODEL_REASONING`, `OPENAI_MODEL_REALTIME`, `OPENAI_MODEL_TRANSCRIBE` and `OPENAI_REALTIME_VOICE`.

## Architecture

```
Recruiter UI (Next.js App Router, server components)      Candidate browser
        │  route handlers (/api/*) — auth, zod, CSRF,           │ camera + mic, MediaRecorder
        │  rate limits, audit                                    │ WebRTC ⇄ OpenAI Realtime (ephemeral secret)
        ▼                                                        ▼
   Services (lib/services/*)                 InterviewController (lib/interview/controller.ts)
        │                                     ├─ state machine (pure, unit-tested)
        │                                     ├─ answer analyzer → follow-up engine (validated)
        │                                     ├─ transcript + chunked recording persistence
        ▼                                     └─ post-processing: section evaluation → report
   PostgreSQL (RLS per organization)   ·   Private storage (local FS or Supabase)   ·   OpenAI
```

### Live interview loop

1. `POST /api/public/interview/:token/start` creates the first question and returns the line to speak. On refresh or reconnect, the same call resumes the session idempotently.
2. The browser gets a short-lived client secret (`/realtime-session`) and connects to OpenAI Realtime over WebRTC. The API key never reaches the browser. The session disables automatic responses (`create_response: false`), so the voice model only says the lines the backend gives it.
3. Candidate speech is transcribed by the realtime session (`audio.input.transcription`). After the candidate stays silent (semantic VAD plus a grace period), or selects **Done answering**, the answer goes to `/answer`.
4. The controller then:
   1. Stores the answer. This step is idempotent: there is one answer per question.
   2. Runs the answer analyzer.
   3. Asks the follow-up engine only when the rules allow a follow-up.
   4. Validates the AI's suggestion against the limits: at most 2 follow-ups per question, the section time budget, question minimums and maximums, and the total time cap.
   5. Advances the state and returns the next line.
5. Sections are evaluated in the background as they complete. On completion, the recording parts are assembled, the remaining sections are evaluated, and the final report is generated. Each step records its status and can be retried.

### Key directories

| Path | Purpose |
|---|---|
| `app/(app)/*` | Recruiter app: dashboard, jobs, candidates, interviews (viewer with tabs), templates, settings |
| `app/interview/[token]/*` | Candidate flow: welcome → consent → device-check → session → completed |
| `app/api/*` | REST API (recruiter and public candidate routes) |
| `lib/ai/*` | OpenAI client, one service per AI task, demo-mode fallbacks, model config |
| `prompts/*/v1.ts` | Versioned prompts; shared safety rules in `prompts/shared.ts` |
| `lib/interview/*` | State machine, controller, plan builder, recording, processing pipeline |
| `lib/services/*` | Business logic for accounts, jobs, candidates, templates, interviews, workspace |
| `lib/database/db.ts` | `withOrg()` / `withSystem()` transaction helpers that set the RLS context |
| `lib/storage/*` | Storage abstraction: local filesystem with HMAC-signed URLs, or Supabase Storage |
| `supabase/migrations/*` | SQL schema, RLS policies |
| `tests/unit`, `tests/integration`, `tests/e2e` | Vitest unit tests, RLS integration test, Playwright end-to-end test |

## Security and privacy

- **Tenant isolation.** Every tenant table has `organization_id` and a `FORCE ROW LEVEL SECURITY` policy keyed on the transaction-local `app.org_id`. Service code also filters explicitly, and `tests/integration/rls.test.ts` checks the isolation.
- **Authentication and authorization.** Sessions use scrypt password hashes and hashed session tokens in httpOnly SameSite cookies. Permissions are checked server-side for five roles: owner, admin, recruiter, interviewer and viewer (`lib/auth/permissions.ts`).
- **Candidate links.** Links use 256-bit random tokens and only a SHA-256 hash is stored, so rotating a link invalidates the old one. The pages send `no-referrer` and `no-store` headers.
- **Request hardening.** Requests are checked for same-origin (CSRF), rate-limited, validated with zod, and served with secure headers. Error responses are friendly and never include stack traces.
- **Private storage.** Recordings and resumes are private objects. Access goes through short-lived signed URLs, and every recording access is audited.
- **Consent.** Consent is stored with its timestamp and version. Retention policies are configurable, and candidates, recordings, transcripts and reports can each be deleted.
- **Audit log.** It covers lifecycle events, questions, answers, follow-ups, evaluations, report views, evidence views and recording access.
- **Logging.** Logs are structured, and secrets, resume text and transcripts are redacted.
- **Platform admin.** The `/admin` area (companies, users, access requests, free-interview quotas, sign-up code) is only for accounts flagged as platform admins. The flag can only be set from the command line, every admin action is written to `platform_audit_logs`, and admins see counts but never candidate videos, transcripts or resumes.

## Scripts

```bash
npm run dev          # start the dev server
npm run db:migrate   # apply SQL migrations
npm run admin:grant -- you@company.com            # make an existing account a platform admin
npm run admin:grant -- you@company.com --revoke   # remove it
npm run typecheck    # next typegen + tsc
npm run lint
npm test             # vitest (unit + RLS integration)
npm run test:e2e     # playwright end-to-end test (demo AI mode, fake camera/mic)
```


