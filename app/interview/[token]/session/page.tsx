import { redirect } from "next/navigation";
import { CandidateError, CandidateOnHold } from "@/components/interview/candidate-shell";
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
  if (!data.plan_ready) {
    return <CandidateError message={data.plan_failed ? "Your interview couldn't be prepared. Please contact the recruiter." : "Your interview is still being prepared. Please wait a minute and reload this page."} />;
  }
  return (
    <InterviewSession token={token} company={data.company_name} job={data.job_title} interviewerName={data.interviewer_name}
      demoMode={data.demo_mode} candidateName={data.candidate_first_name} brand={data.brand} />
  );
}
