import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight, BarChart3, Bell, Briefcase, ClipboardCheck, Lightbulb, CalendarX2, Check, CheckCircle2, Clock, FileSearch, FileStack,
  Fingerprint, Globe, KeyRound, Link2, Lock, MessageSquareText, PlayCircle, Scale, ScrollText, ShieldCheck, Sparkles,
  Timer, UserCheck, Users, Video, X, Calculator, Code2, GraduationCap, Headphones, HeartPulse, Megaphone, Store, Truck, Workflow,
} from "lucide-react";
import { Copyright, Logo } from "@/components/layout/logo";
import { IdentityMock, InterviewMock, PipelineMock, ReportMock, ScreeningMock } from "@/components/marketing/mocks";
import { SiteHeader } from "@/components/marketing/site-header";
import { DemoVideo } from "@/components/marketing/demo-video";
import { CookieSettingsLink } from "@/components/analytics/analytics";
import { ContactForms } from "@/components/marketing/access-request-form";
import Image from "next/image";
import { DEMO_URL } from "@/lib/marketing";
import { getTrialSettings } from "@/lib/services/platform";
import { getAppLink } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: { absolute: "PickMyHire.ai · AI video interviews with evidence you can verify" },
  description:
    "PickMyHire.ai runs personalized AI video interviews for every candidate and gives recruiters reports where every assessment links to the exact moment in the transcript and recording.",
  openGraph: {
    title: "PickMyHire.ai · AI video interviews with evidence you can verify",
    description: "Interview every candidate. Review only the evidence.",
    type: "website",
  },
};

const BLUE_BTN = "inline-flex items-center justify-center gap-2 rounded-xl bg-[#0B5BD3] px-6 py-3.5 text-base font-semibold text-white shadow-[0_8px_24px_-8px_rgba(11,91,211,0.6)] hover:bg-[#0A4FB8]";
const GHOST_BTN = "inline-flex items-center justify-center gap-2 rounded-xl border border-[#CBD7EA] bg-white px-6 py-3.5 text-base font-semibold text-[#0F1F3A] hover:border-[#0B5BD3] hover:text-[#0B5BD3]";

function Eyebrow({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  return <p className={`text-sm font-semibold tracking-[0.18em] uppercase ${dark ? "text-[#7DB8FF]" : "text-[#0B5BD3]"}`}>{children}</p>;
}

function SectionHead({ eyebrow, title, intro, dark, center }: { eyebrow: string; title: React.ReactNode; intro?: string; dark?: boolean; center?: boolean }) {
  return (
    <div className={center ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      <Eyebrow dark={dark}>{eyebrow}</Eyebrow>
      <h2 className={`mt-3 text-3xl font-bold tracking-tight text-balance sm:text-[2.6rem] sm:leading-[1.15] ${dark ? "text-white" : "text-[#0F1F3A]"}`}>{title}</h2>
      {intro && <p className={`mt-4 text-lg leading-relaxed ${dark ? "text-[#BFD0EA]" : "text-[#4A5874]"}`}>{intro}</p>}
    </div>
  );
}

const GUIDE_TOPICS = [
  { icon: Users, title: "Set up your company", body: "Team, roles, branding and privacy settings.", href: "/guide#3-set-up-your-company" },
  { icon: Workflow, title: "Interview templates", body: "Sections, timing and follow-up limits.", href: "/guide#4-interview-templates" },
  { icon: Briefcase, title: "Create a job", body: "Rounds, application questions and hiring limits.", href: "/guide#5-create-a-job" },
  { icon: Link2, title: "Receive applications", body: "AI screening, the fit check and filters.", href: "/guide#6-receive-applications" },
  { icon: Video, title: "Candidate experience", body: "Invitations, consent and the device check.", href: "/guide#8-what-the-candidate-sees" },
  { icon: FileSearch, title: "Review an AI interview", body: "Report, recording, evaluation and decisions.", href: "/guide#9-review-an-ai-interview" },
  { icon: UserCheck, title: "Human rounds", body: "Scheduling, panels and scorecards.", href: "/guide#10-human-interview-rounds" },
  { icon: ClipboardCheck, title: "Shortlist and hire", body: "The overall result, HR details and notes.", href: "/guide#11-the-candidate-page-and-the-shortlist" },
];

const STEPS = [
  { icon: Briefcase, title: "Create a job", body: "Paste the job description. AI turns it into required and preferred skills, experience and responsibilities." },
  { icon: Link2, title: "Share the apply link", body: "Post one link anywhere. Candidates apply with their resume, and AI screens each one against the requirements." },
  { icon: Lightbulb, title: "Personal interview plan", body: "Every invited candidate gets questions built from the job and their own resume, within your template." },
  { icon: Video, title: "Live AI interview", body: "A voice and video interview with adaptive follow-ups, whenever suits the candidate, with no scheduling." },
  { icon: FileSearch, title: "Evidence report", body: "Each section is assessed and linked to the exact moment in the transcript and recording." },
  { icon: UserCheck, title: "Your team decides", body: "Mark each round Qualified, Not qualified or On hold, add human rounds, and shortlist with the full picture. The AI never decides." },
];

const COMPARE: [string, string, string][] = [
  ["Scheduling", "Days of back-and-forth across calendars and time zones", "Candidates interview the same day, any time"],
  ["Consistency", "Different interviewer, different questions", "Same structure and criteria for every candidate"],
  ["Personalization", "Generic scripts or improvised questions", "Questions built from the job and each resume"],
  ["Notes", "Partial notes written from memory", "Full transcript, recording and structured report"],
  ["Verification", "“Trust me, they were strong”", "Every assessment links to the exact moment"],
  ["Identity", "No easy way to confirm who is on the call", "Face checked against a photo from the setup check"],
  ["Later rounds", "Notes scattered across email and spreadsheets", "Every round, scorecard and decision on one candidate page"],
  ["Recruiter time", "About an hour per candidate", "About 10 minutes of review"],
];

const MORE = [
  { icon: FileStack, title: "Interview templates", body: "Sections, timing, question counts, follow-up limits and evaluation criteria." },
  { icon: BarChart3, title: "Compare candidates", body: "Section assessments side by side, sorted only by criteria you choose." },
  { icon: Users, title: "Team roles", body: "Owner, Admin, Recruiter, Interviewer and Viewer, each seeing only what they should." },
  { icon: Bell, title: "Dashboard and alerts", body: "Pipeline at a glance, new applications, completed interviews and ready reports." },
  { icon: Globe, title: "Nothing to install", body: "Candidates join from the browser with a secure personal link, with captions on." },
  { icon: Timer, title: "Retention controls", body: "Auto-delete old recordings and delete candidate data on request." },
];

const TRUST = [
  { icon: UserCheck, title: "Humans decide", body: "No AI output ever makes a hire or reject decision. Your team decides each round, and every decision records who made it and when." },
  { icon: Scale, title: "Fair by design", body: "Only job-relevant evidence is assessed. No inference from age, gender, accent, appearance or emotion." },
  { icon: Fingerprint, title: "Consent first", body: "Candidates see a plain-language notice and give recorded, timestamped consent before anything starts." },
  { icon: Lock, title: "Company data isolated", body: "Each company's data is separated at the database level, with server-side checks on every request." },
  { icon: KeyRound, title: "Private by default", body: "Resumes and recordings live in private storage and open only through short-lived links." },
  { icon: ScrollText, title: "Full audit trail", body: "Report views, recording access, round decisions, reopened rounds and scorecard changes are all logged." },
];

const TEAM_SHOTS = [
  {
    icon: Briefcase,
    title: "Create a job in minutes",
    body: "Paste the job description and pick an interview template. PickMyHire.ai extracts the requirements and is ready to screen and interview.",
    points: ["Required and preferred skills extracted automatically", "Choose a template: sections, timing and follow-up limits", "Turn on a public apply link with one switch"],
    src: "/marketing/job.webp",
    alt: "Job page showing parsed requirements, applications and interviews",
  },
  {
    icon: Link2,
    title: "Invite candidates with a secure link",
    body: "Add a candidate with their resume and send a personal interview link by email, or copy it and share it yourself.",
    points: ["One personal, expiring link per candidate", "Reminders and new links in one click", "The interview plan is tailored to the resume automatically"],
    src: "/marketing/invite.webp",
    alt: "Invitation dialog showing a candidate's secure interview link",
  },
  {
    icon: Users,
    title: "Bring your whole team",
    body: "Invite colleagues and give each person the right access, from owners and admins to interviewers who only review interviews.",
    points: ["Five roles: Owner, Admin, Recruiter, Interviewer, Viewer", "Candidate data visible only to hiring roles", "Every sensitive action recorded in an audit log"],
    src: "/marketing/team.webp",
    alt: "Team settings page listing members and their roles",
  },
  {
    icon: ClipboardCheck,
    title: "Run the next rounds together",
    body: "Schedule human interviews with your panel, collect a scorecard from each interviewer, and decide each round as a team.",
    points: ["Invite and calendar file with your Zoom, Meet or Teams link", "Each interviewer rates your criteria and recommends an outcome", "Decision locks the scorecards, with full history kept"],
    src: "/marketing/scorecard.webp",
    alt: "Human interview page with the panel's scorecards and the team's decision",
  },
];

const INDUSTRIES = [
  { icon: Code2, name: "Technology and IT", roles: "Developers, QA, DevOps, product managers" },
  { icon: Megaphone, name: "Sales and marketing", roles: "Sales executives, account managers, digital marketers" },
  { icon: Headphones, name: "Customer support and BPO", roles: "Support agents, team leads, quality analysts" },
  { icon: Calculator, name: "Finance and accounting", roles: "Accountants, financial analysts, finance operations" },
  { icon: Workflow, name: "HR and operations", roles: "Recruiters, HR generalists, operations managers" },
  { icon: HeartPulse, name: "Healthcare administration", roles: "Patient coordinators, front office, medical admin" },
  { icon: Store, name: "Retail and hospitality", roles: "Store managers, supervisors, guest relations" },
  { icon: Truck, name: "Logistics and supply chain", roles: "Coordinators, planners, warehouse supervisors" },
  { icon: GraduationCap, name: "Education and training", roles: "Teachers, trainers, counsellors" },
  { icon: Briefcase, name: "Consulting and services", roles: "Consultants, project managers, analysts" },
];

const ABOUT_POINTS = [
  { icon: Clock, text: "Faster hiring rounds, with less scheduling" },
  { icon: ShieldCheck, text: "Privacy, consent and fairness built in" },
  { icon: MessageSquareText, text: "Structured, evidence-based conversations" },
];

const FAQ = [
  ["Do candidates need to install anything?", "No. Candidates open a secure personal link in a modern browser, give consent, run a quick camera and microphone check, and start. They can also type an answer instead of speaking."],
  ["Can the AI reject candidates?", "No. PickMyHire.ai never makes hire or reject decisions. Application tags and interview assessments are summaries of evidence that help your team prioritise. Every decision stays with people."],
  ["How does the AI decide what to ask?", "Each interview follows your template: sections, timing, number of questions and follow-up limits. Within that structure the AI personalizes questions from the job and the candidate's resume, and asks a follow-up only when an answer leaves a specific gap."],
  ["How do I know the assessments are right?", "You don't have to take them on trust. Every assessment comes with evidence: click it and the recording jumps to that moment, with the transcript highlighted."],
  ["Does it work for my industry?", "Yes, for any role where a structured conversation shows fit: technology, sales, support, finance, operations, healthcare administration, education and more. Questions come from your job description and each candidate's resume, and templates let you set the sections and criteria for each role. Interviews are currently in English, and they assess what candidates say, so hands-on skills such as live coding or practical trade work still need their own test."],
  ["Can you tell if someone else takes the interview?", "Yes, with the identity check, which you can switch on for each job. The candidate's photo is taken at the setup check, and during the AI interview their face is compared with it every few seconds. A different face, a second person in view or an empty frame is flagged with a photo and a link to that moment in the recording. Candidates are told about it and consent first, and the photos are deleted with the recording. Flags are for your team to review: they never end or reject an interview."],
  ["How long is an interview?", "You decide in the template. Typical setups range from a 15-minute screen to a 45-minute structured technical interview."],
  ["What happens if a candidate's connection drops?", "Progress is saved continuously. The candidate reopens their link and continues where they left off, and the recording is kept in parts."],
  ["Can we run human interviews too?", "Yes. Add human rounds to a job, or schedule a one-off interview for a single candidate. Pick the panel, date and time zone, and send the invite. Each interviewer fills in a scorecard with your criteria, and your team marks the round Qualified, Not qualified or On hold. Scorecards lock once a decision is made."],
  ["Does it work with Zoom, Google Meet or Teams?", "Yes. Paste your meeting link when you schedule a human interview. It goes into the invite and the calendar file, so candidates and interviewers join with the tool you already use."],
  ["Where is our data stored, and who can see it?", "Data is stored privately, isolated per company, and access is controlled by roles. For example, interviewers and viewers can't see candidate contact details or resumes. Retention settings let you remove old recordings automatically."],
];
const PRICING_FAQ = "Pricing depends on your hiring volume. Book a demo or contact us and we'll put together a plan for your team.";

export default async function Home() {
  const [trial, app] = await Promise.all([getTrialSettings(), getAppLink()]);
  const trialLine = `${trial.interviews} AI interviews free for ${trial.days} days`;
  const faqs = [...FAQ, ["How much does it cost?", trial.enabled ? `You can start with a free trial: ${trialLine}, no credit card needed. After that, ${PRICING_FAQ.charAt(0).toLowerCase()}${PRICING_FAQ.slice(1)}` : PRICING_FAQ]];
  return (
    <div className="min-h-screen bg-[#F8FAFD] text-[#0F1F3A]">
      <SiteHeader trial={trial.enabled} app={app} />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_30rem_at_85%_-10%,rgba(22,115,255,0.16),transparent),radial-gradient(40rem_24rem_at_0%_10%,rgba(56,189,248,0.10),transparent)]" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 pt-14 pb-20 sm:px-8 lg:grid-cols-[1fr_1.05fr] lg:pt-20 lg:pb-28">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-[#CFE0FA] bg-white px-3.5 py-1.5 text-sm font-medium text-[#0B4FB8]">
              <Sparkles className="size-4" /> AI-powered video interviews
            </p>
            <h1 className="mt-6 text-4xl font-bold tracking-tight text-balance sm:text-6xl sm:leading-[1.05]">
              Interview every candidate. <span className="text-[#0B5BD3]">Review only the evidence.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-[#4A5874] sm:text-xl">
              PickMyHire.ai runs personalized AI video interviews for every candidate and gives your team reports where every assessment links to the exact moment in the transcript and recording.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              {app || trial.enabled ? (
                <>
                  <Link href={app?.href ?? "/signup"} className={BLUE_BTN}>{app?.label ?? "Start free trial"} <ArrowRight className="size-4" /></Link>
                  {!app && <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className={GHOST_BTN}>Book a demo</a>}
                </>
              ) : (
                <>
                  <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className={BLUE_BTN}>Book a demo <ArrowRight className="size-4" /></a>
                  <a href="#contact" className={GHOST_BTN}>Contact us</a>
                </>
              )}
            </div>
            {trial.enabled && !app && <p className="mt-3 text-sm text-[#5A6A86]">{trialLine} · No credit card · Work email required</p>}
            <ul className="mt-8 grid gap-2.5 text-sm text-[#3D4D6A] sm:grid-cols-2">
              {["Interviews available 24/7", "Questions tailored to each resume", "Evidence behind every assessment", "Your team makes every decision"].map((t) => (
                <li key={t} className="flex items-center gap-2"><CheckCircle2 className="size-4 text-[#0B5BD3]" />{t}</li>
              ))}
            </ul>
          </div>
          <div className="relative">
            <ReportMock />
            <p className="mt-3 text-center text-xs text-[#7A8AA6]">Product preview with sample data</p>
          </div>
        </div>
      </section>

      {/* Key facts */}
      <section className="border-y border-[#E3EAF5] bg-white">
        <div className="mx-auto grid max-w-7xl grid-cols-2 divide-x divide-[#E3EAF5] px-5 sm:px-8 lg:grid-cols-4">
          {[["~10 min", "of recruiter review per candidate, instead of about an hour*"], ["Same day", "first interviews, with no scheduling"], ["2–4 s", "for the AI interviewer to respond after an answer"], ["24/7", "interviews, whenever candidates are available"]].map(([n, l]) => (
            <div key={n} className="px-4 py-8 text-center sm:px-6">
              <p className="text-3xl font-bold tracking-tight text-[#0B5BD3] sm:text-4xl">{n}</p>
              <p className="mx-auto mt-2 max-w-[16rem] text-sm leading-snug text-[#4A5874]">{l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Product demo */}
      <section id="demo" className="scroll-mt-20 py-24">
        <div className="mx-auto max-w-5xl px-5 sm:px-8">
          <SectionHead center eyebrow="Product demo" title="See PickMyHire.ai in action" intro="A 4-minute walkthrough: a real AI interview, then every round from job to shortlist, with the identity check, human interviews and the overall result." />
          <DemoVideo className="mt-12" />
          <p className="mt-4 text-center text-sm text-[#7A8AA6]">Recorded with sample data, apart from the real candidate interview.</p>
          <p className="mt-3 text-center text-base text-[#3D4D6A]">Want the full product walkthrough? <Link href="/demo#walkthrough" className="inline-flex items-center gap-1 font-semibold text-[#0B5BD3] hover:underline">Watch the 11-minute version <ArrowRight className="size-4" /></Link></p>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="scroll-mt-20 py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <SectionHead center eyebrow="How it works" title="From job post to decision, in six steps" intro="Your team sets up the role and reviews the evidence. PickMyHire.ai handles everything in between." />
          <ol className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="relative rounded-2xl border border-[#DCE4F0] bg-white p-6">
                <div className="flex items-center justify-between">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-[#E9F1FD] text-[#0B5BD3]"><Icon className="size-5" /></span>
                  <span className="font-mono text-sm font-semibold text-[#9AB0D0]">0{i + 1}</span>
                </div>
                <h3 className="mt-5 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#4A5874]">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-20 bg-white py-24">
        <div className="mx-auto max-w-7xl space-y-24 px-5 sm:px-8">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <SectionHead eyebrow="Applications and AI screening" title="One link to apply. Every applicant screened against the role." />
              <ul className="mt-7 space-y-3.5 text-base text-[#3D4D6A]">
                {["Share a public apply link on LinkedIn, job boards or your careers page", "Each applicant becomes a candidate automatically, with the resume parsed", "Every requirement is checked against the resume, with quoted evidence", "Match tags are capped by evidence, and nobody is ever auto-rejected"].map((t) => (
                  <li key={t} className="flex gap-3"><Check className="mt-0.5 size-5 shrink-0 text-[#0B5BD3]" />{t}</li>
                ))}
              </ul>
            </div>
            <ScreeningMock />
          </div>

          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div className="lg:order-2">
              <SectionHead eyebrow="The AI interviewer" title="A real conversation, not a questionnaire" />
              <ul className="mt-7 space-y-3.5 text-base text-[#3D4D6A]">
                {["Personalized questions from the job and the candidate's resume", "Targeted follow-ups only when an answer leaves a real gap", "Responds in seconds, and never cuts off a thinking pause", "Works within your template's sections, timing and limits", "Never reveals scores or asks inappropriate questions"].map((t) => (
                  <li key={t} className="flex gap-3"><Check className="mt-0.5 size-5 shrink-0 text-[#0B5BD3]" />{t}</li>
                ))}
              </ul>
            </div>
            <div className="lg:order-1"><InterviewMock /></div>
          </div>

          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <SectionHead eyebrow="Evidence-backed reports" title="Verify any assessment in seconds" />
              <ul className="mt-7 space-y-3.5 text-base text-[#3D4D6A]">
                {["Section-by-section assessment, with an optional 1–5 score", "Strengths and areas to explore in the next round", "Full timestamped transcript and video recording", "Click any evidence: the video jumps to that exact moment", "Compare candidates for the same job side by side"].map((t) => (
                  <li key={t} className="flex gap-3"><Check className="mt-0.5 size-5 shrink-0 text-[#0B5BD3]" />{t}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-[#DCE4F0] bg-[#F8FAFD] p-6">
              <div className="space-y-3">
                {[["Strength", "Owns production systems end to end", "12:41"], ["Strength", "Clear trade-off reasoning on data design", "18:09"], ["Explore next", "Limited evidence on Kubernetes at scale", "22:30"]].map(([k, t, ts]) => (
                  <div key={t} className="flex items-center gap-4 rounded-xl border border-[#E3EAF5] bg-white p-4">
                    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${k === "Strength" ? "bg-[#DDF5E8] text-[#0B6B3A]" : "bg-[#FDF0D9] text-[#8A5300]"}`}>{k}</span>
                    <p className="flex-1 text-sm font-medium">{t}</p>
                    <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-[#0B5BD3]"><PlayCircle className="size-4" />{ts}</span>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-center text-xs text-[#7A8AA6]">Sample report findings</p>
            </div>
          </div>

          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
            <div className="lg:order-2">
              <SectionHead eyebrow="Rounds, decisions and shortlist" title="Every round, from first interview to shortlist, in one place" />
              <ul className="mt-7 space-y-3.5 text-base text-[#3D4D6A]">
                {["Mix AI and human interview rounds in each job", "Your team marks every round Qualified, Not qualified or On hold, with who decided and when", "Schedule, reschedule or cancel human interviews, with a calendar invite and your own Zoom, Meet or Teams link", "Each interviewer fills in their own scorecard against your criteria", "Scorecards lock after a decision; reopening needs a reason, and earlier versions are kept"].map((t) => (
                  <li key={t} className="flex gap-3"><Check className="mt-0.5 size-5 shrink-0 text-[#0B5BD3]" />{t}</li>
                ))}
              </ul>
            </div>
            <div className="lg:order-1"><PipelineMock /><p className="mt-3 text-center text-xs text-[#7A8AA6]">Sample hiring progress</p></div>
          </div>

          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <SectionHead eyebrow="Identity check" title="Know it's the same person, from start to finish" />
              <ul className="mt-7 space-y-3.5 text-base text-[#3D4D6A]">
                {["A photo is taken at the setup check, before the interview starts", "The candidate's face is compared with it every few seconds, on their own device", "Flags a different face, a second person in view, or no one in view", "Each flag has a photo and jumps to that moment in the video", "Candidates are told and give consent first. Flags are for your team to review, and never end or reject an interview", "Switch it on or off for each job"].map((t) => (
                  <li key={t} className="flex gap-3"><Check className="mt-0.5 size-5 shrink-0 text-[#0B5BD3]" />{t}</li>
                ))}
              </ul>
            </div>
            <div><IdentityMock /><p className="mt-3 text-center text-xs text-[#7A8AA6]">Sample identity check</p></div>
          </div>

          <div>
            <SectionHead eyebrow="And everything else" title="Built for real hiring teams" />
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {MORE.map(({ icon: Icon, title, body }) => (
                <div key={title} className="rounded-2xl border border-[#DCE4F0] bg-[#F8FAFD] p-6">
                  <Icon className="size-6 text-[#0B5BD3]" />
                  <h3 className="mt-4 font-semibold">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-[#4A5874]">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Team: jobs, team management, invitations (real screenshots) */}
      <section id="team" className="scroll-mt-20 py-24">
        <div className="mx-auto max-w-7xl space-y-20 px-5 sm:px-8">
          <SectionHead center eyebrow="For hiring teams" title="Set up a role, invite candidates and run every round" intro="Everything your team needs to hire together, from the first invite to the final round, with the right access for each person." />
          {TEAM_SHOTS.map((shot, i) => (
            <div key={shot.title} className="grid items-center gap-10 lg:grid-cols-[1fr_1.35fr]">
              <div className={i % 2 ? "lg:order-2" : ""}>
                <span className="flex size-11 items-center justify-center rounded-xl bg-[#E9F1FD] text-[#0B5BD3]"><shot.icon className="size-5" /></span>
                <h3 className="mt-5 text-2xl font-bold tracking-tight sm:text-3xl">{shot.title}</h3>
                <p className="mt-3 text-lg leading-relaxed text-[#4A5874]">{shot.body}</p>
                <ul className="mt-5 space-y-2.5 text-[15px] text-[#3D4D6A]">
                  {shot.points.map((t) => <li key={t} className="flex gap-3"><Check className="mt-0.5 size-5 shrink-0 text-[#0B5BD3]" />{t}</li>)}
                </ul>
              </div>
              <div className={i % 2 ? "lg:order-1" : ""}>
                <div className="overflow-hidden rounded-2xl border border-[#DCE4F0] bg-white shadow-[0_24px_60px_-20px_rgba(11,30,61,0.25)]">
                  <Image src={shot.src} alt={shot.alt} width={1600} height={1000} sizes="(min-width: 1280px) 680px, (min-width: 1024px) 55vw, 100vw" className="h-auto w-full" />
                </div>
                <p className="mt-3 text-center text-xs text-[#7A8AA6]">Screenshot of the PickMyHire.ai app with sample data</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Industries */}
      <section id="industries" className="scroll-mt-20 bg-white py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <SectionHead center eyebrow="Industries" title="One platform for every role you hire for" intro="Each interview is built from your job description and the candidate's resume, so it adapts to the role, not a fixed question bank." />
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {INDUSTRIES.map(({ icon: Icon, name, roles }) => (
              <div key={name} className="rounded-2xl border border-[#E3EAF5] bg-[#F8FAFD] p-5">
                <div className="flex size-10 items-center justify-center rounded-xl bg-[#E6EFFC]"><Icon className="size-5 text-[#0B5BD3]" /></div>
                <p className="mt-4 font-semibold text-[#0F1F3A]">{name}</p>
                <p className="mt-1 text-sm leading-relaxed text-[#5A6A86]">{roles}</p>
              </div>
            ))}
          </div>
          <p className="mx-auto mt-10 max-w-2xl text-center text-[15px] leading-relaxed text-[#4A5874]">
            Templates set the sections, timing and evaluation criteria for each role, so a sales screen and an accounting interview each feel right for the job.
          </p>
        </div>
      </section>

      {/* Why: before vs after */}
      <section id="why" className="scroll-mt-20 py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <SectionHead center eyebrow="Why PickMyHire.ai" title="Every interview round, without the grind" />
          <div className="mt-12 overflow-hidden rounded-2xl border border-[#DCE4F0] bg-white">
            <div className="hidden grid-cols-[180px_1fr_1fr] border-b border-[#E3EAF5] bg-[#F3F7FC] text-sm font-semibold md:grid">
              <p className="px-6 py-4 text-[#5A6A86]" />
              <p className="flex items-center gap-2 px-6 py-4 text-[#5A6A86]"><CalendarX2 className="size-4" /> Traditional phone screens</p>
              <p className="flex items-center gap-2 px-6 py-4 text-[#0B5BD3]"><Sparkles className="size-4" /> With PickMyHire.ai</p>
            </div>
            {COMPARE.map(([k, a, b]) => (
              <div key={k} className="grid border-b border-[#EEF2F8] last:border-0 md:grid-cols-[180px_1fr_1fr]">
                <p className="px-6 pt-5 text-sm font-semibold md:py-5">{k}</p>
                <p className="flex items-start gap-2 px-6 py-2 text-sm text-[#5A6A86] md:py-5"><X className="mt-0.5 size-4 shrink-0 text-[#B04A3B]" />{a}</p>
                <p className="flex items-start gap-2 px-6 pt-1 pb-5 text-sm font-medium md:py-5"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#0B5BD3]" />{b}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-center text-xs text-[#7A8AA6]">*Recruiter time is an illustrative estimate (scheduling, a 30-minute call and write-up, versus reviewing a report). Your numbers will vary.</p>
        </div>
      </section>

      {/* Trust */}
      <section id="trust" className="scroll-mt-20 bg-[#0B1E3D] py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <SectionHead dark eyebrow="Trust, fairness and security" title="AI that supports your judgement, and never replaces it" intro="The AI handles the language work: questions, analysis and summaries. The platform controls the interview process, data and security." />
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {TRUST.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-2xl border border-[#24406E] bg-[#132B52] p-6">
                <Icon className="size-6 text-[#7DB8FF]" />
                <h3 className="mt-4 font-semibold text-white">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#BFD0EA]">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* About */}
      <section id="about" className="scroll-mt-20 py-24">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 sm:px-8 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <SectionHead eyebrow="About us" title="Built by Deligence Technologies" />
            <div className="mt-6 space-y-4 text-lg leading-relaxed text-[#4A5874]">
              <p>We&apos;re a technology company focused on practical AI. We built PickMyHire.ai because interviews take the most recruiter time and often give the least reliable signal: rushed calls, inconsistent questions and notes written from memory, round after round.</p>
              <p>PickMyHire.ai makes every round consistent, personalized and verifiable, so your team spends its time on the candidates and decisions that matter.</p>
            </div>
          </div>
          <div className="rounded-2xl border border-[#DCE4F0] bg-white p-8">
            <Logo height={40} />
            <ul className="mt-6 space-y-3 text-sm text-[#3D4D6A]">
              {ABOUT_POINTS.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-3"><Icon className="size-5 text-[#0B5BD3]" />{text}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 bg-white py-24">
        <div className="mx-auto max-w-3xl px-5 sm:px-8">
          <SectionHead center eyebrow="FAQ" title="Questions recruiters ask us" />
          <div className="mt-10 divide-y divide-[#E3EAF5] rounded-2xl border border-[#DCE4F0]">
            {faqs.map(([q, a]) => (
              <details key={q} className="group px-6 py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold [&::-webkit-details-marker]:hidden">
                  {q}
                  <span className="text-xl leading-none text-[#0B5BD3] transition-transform group-open:rotate-45" aria-hidden>+</span>
                </summary>
                <p className="mt-3 text-[15px] leading-relaxed text-[#4A5874]">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Product guide */}
      <section id="guide" className="scroll-mt-20 border-t border-[#E3EAF5] bg-white py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <SectionHead center eyebrow="Product guide" title="Step-by-step help, whenever you need it" intro="Every feature explained with screenshots, from setting up your company to the shortlist. Jump straight to the part you need." />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {GUIDE_TOPICS.map(({ icon: Icon, title, body, href }) => (
              <Link key={href} href={href} className="group rounded-2xl border border-[#DCE4F0] bg-[#F8FAFD] p-5 transition hover:-translate-y-0.5 hover:border-[#0B5BD3] hover:bg-white hover:shadow-md">
                <span className="flex size-10 items-center justify-center rounded-xl bg-[#E6EFFC] text-[#0B5BD3]"><Icon className="size-5" /></span>
                <p className="mt-4 font-semibold group-hover:text-[#0B5BD3]">{title}</p>
                <p className="mt-1 text-sm leading-relaxed text-[#5A6A86]">{body}</p>
              </Link>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Link href="/guide" className={BLUE_BTN}>Open the product guide <ArrowRight className="size-4" /></Link>
          </div>
        </div>
      </section>

      {/* Contact: support for signed-in customers, request access / contact us for everyone else */}
      {app ? (
        <section id="contact" className="scroll-mt-20 py-24">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0B5BD3] to-[#0B1E3D] p-8 sm:p-12">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(30rem_16rem_at_80%_0%,rgba(125,184,255,0.35),transparent)]" />
              <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
                <div className="max-w-2xl">
                  <Eyebrow dark>Help and support</Eyebrow>
                  <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance text-white sm:text-[2.6rem] sm:leading-[1.15]">Need help with your account?</h2>
                  <p className="mt-5 text-lg leading-relaxed text-[#D6E6FF]">Write to our support team from inside the app. We&apos;ll reply there, and you can follow every request in one place.</p>
                </div>
                <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
                  <Link href="/help" className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-3.5 text-base font-semibold text-[#0B4FB8] hover:bg-[#EAF2FF]">Contact support <ArrowRight className="size-4" /></Link>
                  <Link href={app.href} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/40 px-6 py-3.5 text-base font-semibold text-white hover:bg-white/10">{app.label}</Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section id="contact" className="relative scroll-mt-20 py-24">
          <span id="request-access" className="absolute top-0 scroll-mt-20" aria-hidden />
          <div className="mx-auto grid max-w-7xl gap-8 px-5 sm:px-8 lg:grid-cols-[1fr_1.1fr]">
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0B5BD3] to-[#0B1E3D] p-8 sm:p-12">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(30rem_16rem_at_80%_0%,rgba(125,184,255,0.35),transparent)]" />
              <div className="relative flex h-full flex-col">
                <Eyebrow dark>Contact us</Eyebrow>
                <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance text-white sm:text-[2.6rem] sm:leading-[1.15]">See PickMyHire.ai on your next open role</h2>
                <p className="mt-5 text-lg leading-relaxed text-[#D6E6FF]">Book a 20-minute demo. We&apos;ll show the full flow, from apply link to evidence-backed report, and talk through pricing for your hiring volume.</p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  {trial.enabled && <Link href="/signup" className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-3.5 text-base font-semibold text-[#0B4FB8] hover:bg-[#EAF2FF]">Start free trial <ArrowRight className="size-4" /></Link>}
                  <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className={trial.enabled
                    ? "inline-flex items-center justify-center gap-2 rounded-xl border border-white/40 px-6 py-3.5 text-base font-semibold text-white hover:bg-white/10"
                    : "inline-flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-3.5 text-base font-semibold text-[#0B4FB8] hover:bg-[#EAF2FF]"}>Book a demo {!trial.enabled && <ArrowRight className="size-4" />}</a>
                </div>
                <div className="flex-1" />
                <p className="mt-8 text-sm text-[#BFD3F5]">{trial.enabled
                  ? <>Start a free trial in a minute ({trialLine}), or book a call and we&apos;ll set up your workspace. Questions about pricing or anything else? Use Contact us.</>
                  : <>Access is by approval. Request access with the form, or book a call, and we&apos;ll set up your workspace. Questions about pricing or anything else? Use Contact us.</>}</p>
              </div>
            </div>
            <ContactForms />
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="border-t border-[#E3EAF5] bg-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr]">
          <div className="space-y-4">
            <Logo height={36} />
            <p className="max-w-sm text-sm leading-relaxed text-[#5A6A86]">AI video interviews with evidence you can verify. Interview every candidate; review only the evidence.</p>
          </div>
          <div>
            <p className="text-sm font-semibold">Product</p>
            <ul className="mt-4 space-y-2.5 text-sm text-[#5A6A86]">
              <li><a href="#how-it-works" className="hover:text-[#0B5BD3]">How it works</a></li>
              <li><a href="#features" className="hover:text-[#0B5BD3]">Features</a></li>
              <li><a href="#industries" className="hover:text-[#0B5BD3]">Industries</a></li>
              <li><a href="#trust" className="hover:text-[#0B5BD3]">Trust and security</a></li>
              <li><a href="#faq" className="hover:text-[#0B5BD3]">FAQ</a></li>
              <li><Link href="/guide" className="hover:text-[#0B5BD3]">Product guide</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold">Contact</p>
            <ul className="mt-4 space-y-2.5 text-sm text-[#5A6A86]">
              {app ? (
                <>
                  <li><Link href={app.href} className="hover:text-[#0B5BD3]">{app.label}</Link></li>
                  <li><Link href="/help" className="hover:text-[#0B5BD3]">Help and support</Link></li>
                </>
              ) : (
                <>
                  {trial.enabled && <li><Link href="/signup" className="hover:text-[#0B5BD3]">Start free trial</Link></li>}
                  <li><a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="hover:text-[#0B5BD3]">Book a demo</a></li>
                  <li><a href="#request-access" className="hover:text-[#0B5BD3]">Request access</a></li>
                  <li><a href="#contact" className="hover:text-[#0B5BD3]">Contact us</a></li>
                </>
              )}
            </ul>
          </div>
        </div>
        <div className="border-t border-[#E3EAF5] py-6 text-center"><Copyright /><div className="mt-2 flex items-center justify-center gap-4 text-xs text-[#5A6A86]"><Link href="/cookies" className="hover:text-[#0B5BD3]">Cookie policy</Link><CookieSettingsLink className="hover:text-[#0B5BD3]" /></div></div>
      </footer>
    </div>
  );
}
