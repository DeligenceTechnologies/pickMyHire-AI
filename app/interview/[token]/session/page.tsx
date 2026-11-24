import { redirect } from "next/navigation";
import { CandidateError, CandidateOnHold, CandidateShell } from "@/components/interview/candidate-shell";
import { PreparingInterview } from "@/components/interview/preparing-interview";
import { InterviewSession } from "@/components/interview/session/interview-session";
import { candidateStep, loadPublicInterview } from "@/lib/interview/public-page";

export default async function SessionPage(props: PageProps<"/interview/[token]/session">) {
  const { token } = await props.params;
  const { data, error } = await loadPublicInterview(token);
  if (!data) return <CandidateError message={error} />;
  const step = candidateStep(data);
  if (data.on_hold) return <CandidateOnHold brand={data.brand} job={data.job_title} company={data.company_name} first={data.candidate_first_name} contact={data.on_hold.contact} />;
  if (step === "completed") redirect(`/interview/${token}/completed`);
  if (step === "welcome") redirect(`/interview/${token}/consent`);
  if (data.plan_failed) return <CandidateError message="Your interview couldn't be prepared. Please contact the recruiter." />;
  if (!data.plan_ready) {
    return <CandidateShell brand={data.brand} job={data.job_title}><PreparingInterview token={token} /></CandidateShell>;
  }
  return (
    <InterviewSession token={token} company={data.company_name} job={data.job_title} interviewerName={data.interviewer_name}
      demoMode={data.demo_mode} candidateName={data.candidate_first_name} brand={data.brand} introLines={data.intro_lines} />
  );
}
