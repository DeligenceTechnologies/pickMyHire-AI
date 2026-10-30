import Link from "next/link";
import { redirect } from "next/navigation";
import { Camera, Clock, Mic, ShieldCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { CandidateError, CandidateShell } from "@/components/interview/candidate-shell";
import { candidateStep, loadPublicInterview } from "@/lib/interview/public-page";

export default async function WelcomePage(props: PageProps<"/interview/[token]">) {
  const { token } = await props.params;
  const { data, error } = await loadPublicInterview(token);
  if (!data) return <CandidateError message={error} />;
  const step = candidateStep(data);
  if (step === "completed") redirect(`/interview/${token}/completed`);
  if (step === "session") redirect(`/interview/${token}/session`);
  return (
    <CandidateShell brand={data.brand} job={data.job_title} step={0}>
      <h1 className="text-3xl font-semibold tracking-tight">Hi {data.candidate_first_name}, welcome.</h1>
      <p className="mt-3 text-muted-foreground">
        {data.company_name} has invited you to an AI-assisted interview for the <strong className="text-foreground">{data.job_title}</strong> role.
        {" "}{data.interviewer_name}, an AI interviewer, will ask you questions by voice — one at a time — and may ask short follow-ups.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {[
          { icon: Clock, t: "About " + (data.total_minutes ? `${data.total_minutes} minutes` : "30–45 minutes"), d: data.section_names.length ? `${data.section_names.length} parts: ${data.section_names.join(", ")}.` : "Your interview is being prepared." },
          { icon: Camera, t: "Camera & microphone", d: "Use a computer with a working camera and microphone. Headphones help." },
          { icon: Mic, t: "Speak naturally", d: "Take your time. Pause or select “Done answering” when you finish an answer." },
          { icon: ShieldCheck, t: "Recorded & reviewed by people", d: "Your interview is recorded and transcribed. The hiring team makes all decisions." },
        ].map(({ icon: Icon, t, d }) => (
          <div key={t} className="rounded-xl border bg-card p-5"><Icon className="size-5 text-primary" /><p className="mt-3 font-medium">{t}</p><p className="mt-1 text-sm text-muted-foreground">{d}</p></div>
        ))}
      </div>
      <p className="mt-8 text-sm text-muted-foreground">Find a quiet, well-lit place. If you get disconnected, reopen this link within 10 minutes to continue where you left off. After that, the link closes and your interview is sent as it is.</p>
      <Link href={`/interview/${token}/${step === "device-check" ? "device-check" : "consent"}`} className={`${buttonVariants({ size: "lg" })} mt-8 h-11 px-6`}>Get started</Link>
    </CandidateShell>
  );
}
