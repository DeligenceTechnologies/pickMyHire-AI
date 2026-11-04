import { OrgSettingsForm } from "@/components/settings/org-settings-form";
import { AI_CONFIG } from "@/lib/ai/config";
import { can } from "@/lib/auth/permissions";
import { requireAuth } from "@/lib/auth/session";
import { aiIsLive } from "@/lib/env";
import { getSettings } from "@/lib/services/workspace";

export const metadata = { title: "Interview settings" };

export default async function InterviewSettingsPage() {
  const auth = await requireAuth();
  const { name, settings } = await getSettings(auth.orgId);
  // Model names are internal: only the platform admin sees them. Everyone else sees whether AI is connected.
  const models = auth.isPlatformAdmin ? {
    "Resume parser": AI_CONFIG.resumeParser, "Job parser": AI_CONFIG.jobParser, "Interview planner": AI_CONFIG.interviewPlanner,
    "Live answer turn": `${AI_CONFIG.answerTurn.model} (reasoning ${AI_CONFIG.answerTurn.reasoningEffort})`, "Background answer analysis": AI_CONFIG.answerAnalyzer, "Evaluator": AI_CONFIG.evaluator,
    "Report generator": AI_CONFIG.reportGenerator, "Realtime voice": AI_CONFIG.realtime, "Transcription": AI_CONFIG.transcription, "Voice": AI_CONFIG.voice,
  } : null;
  return <OrgSettingsForm orgName={name} settings={settings} canEdit={can(auth.role, "org:manage")} ai={{ live: aiIsLive(), models }} />;
}
