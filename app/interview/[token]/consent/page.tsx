import { redirect } from "next/navigation";
import { CandidateError, CandidateOnHold, CandidateShell } from "@/components/interview/candidate-shell";
import { ConsentScreen } from "@/components/interview/consent-screen";
import { candidateStep, loadPublicInterview } from "@/lib/interview/public-page";

export default async function ConsentPage(props: PageProps<"/interview/[token]/consent">) {
  const { token } = await props.params;
  const { data, error } = await loadPublicInterview(token);
  if (!data) return <CandidateError message={error} />;
  const step = candidateStep(data);
  if (data.on_hold) return <CandidateOnHold brand={data.brand} job={data.job_title} company={data.company_name} first={data.candidate_first_name} contact={data.on_hold.contact} />;
  if (step === "completed" || step === "session") redirect(`/interview/${token}/${step}`);
  return (
    <CandidateShell brand={data.brand} job={data.job_title} step={1}>
      <ConsentScreen token={token} company={data.company_name} version={data.consent_version} minutes={data.total_minutes} faceVerification={data.face_verification} />
    </CandidateShell>
  );
}
