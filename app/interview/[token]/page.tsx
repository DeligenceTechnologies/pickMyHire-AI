import Link from "next/link";
import { redirect } from "next/navigation";
import { Camera, Clock, Mic, ShieldCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { CandidateError, CandidateOnHold, CandidateShell } from "@/components/interview/candidate-shell";
import { candidateStep, loadPublicInterview } from "@/lib/interview/public-page";
import { durationText } from "@/lib/interview/duration";

export default async function WelcomePage(props: PageProps<"/interview/[token]">) {
  const { token } = await props.params;
  const { data, error } = await loadPublicInterview(token);
  if (!data) return <CandidateError message={error} />;
  const step = candidateStep(data);
  if (data.on_hold) return <CandidateOnHold brand={data.brand} job={data.job_title} company={data.company_name} first={data.candidate_first_name} contact={data.on_hold.contact} />;
  if (step === "completed") redirect(`/interview/${token}/completed`);
  if (step === "session") redirect(`/interview/${token}/session`);
  return (
    <CandidateShell brand={data.brand} job={data.job_title} step={0}>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Hi {data.candidate_first_name}, welcome.</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
        {data.company_name} has invited you to an AI-assisted interview for the <strong className="text-foreground">{data.job_title}</strong> role.
        {" "}{data.interviewer_name}, an AI interviewer, will ask you questions by voice — one at a time — and may ask short follow-ups.
      </p>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2">
        {[
          { icon: Clock, t: "Usually " + (durationText(data.total_minutes) ?? "30–45 minutes"), d: data.section_names.length ? `In ${data.section_names.length} parts, one question at a time.` : "One question at a time, by voice." },
          { icon: Camera, t: "Camera & microphone", d: "Use a computer with a working camera and microphone. Headphones help." },
          { icon: Mic, t: "Speak naturally", d: "Take your time. Pause or select “Done answering” when you finish. Don’t know an answer? Just say so." },
          { icon: ShieldCheck, t: "Recorded & reviewed by people", d: "Your interview is recorded and transcribed. The hiring team makes all decisions." },
        ].map(({ icon: Icon, t, d }) => (
          <li key={t} className="flex gap-3 rounded-xl border bg-card p-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Icon className="size-[18px]" aria-hidden /></span>
            <span className="min-w-0">
              <span className="block font-medium">{t}</span>
              <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">{d}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
        <Link href={`/interview/${token}/${step === "device-check" ? "device-check" : "consent"}`} className={`${buttonVariants({ size: "lg" })} h-11 shrink-0 px-8`}>Get started</Link>
        <p className="text-sm leading-snug text-muted-foreground">Find a quiet, well-lit place. If you get disconnected, reopen this link within 10 minutes to continue where you left off. After that, the link closes and your interview is sent as it is.</p>
      </div>
    </CandidateShell>
  );
}
