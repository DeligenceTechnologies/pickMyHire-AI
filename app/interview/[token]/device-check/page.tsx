import { redirect } from "next/navigation";
import { CandidateError, CandidateOnHold, CandidateShell } from "@/components/interview/candidate-shell";
import { DeviceCheck } from "@/components/interview/device-check";
import { candidateStep, loadPublicInterview } from "@/lib/interview/public-page";

export default async function DeviceCheckPage(props: PageProps<"/interview/[token]/device-check">) {
  const { token } = await props.params;
  const { data, error } = await loadPublicInterview(token);
  if (!data) return <CandidateError message={error} />;
  const step = candidateStep(data);
  if (data.on_hold) return <CandidateOnHold brand={data.brand} job={data.job_title} company={data.company_name} first={data.candidate_first_name} contact={data.on_hold.contact} />;
  if (step === "completed" || step === "session") redirect(`/interview/${token}/${step}`);
  if (step === "welcome") redirect(`/interview/${token}/consent`);
  return (
    <CandidateShell brand={data.brand} job={data.job_title} step={2}>
      <DeviceCheck token={token} planReady={data.plan_ready} faceVerification={data.face_verification} />
    </CandidateShell>
  );
}
