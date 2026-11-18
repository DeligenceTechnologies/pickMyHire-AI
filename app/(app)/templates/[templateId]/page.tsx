import { notFound } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { TemplateEditor } from "@/components/templates/template-editor";
import { can } from "@/lib/auth/permissions";
import { requireAuth } from "@/lib/auth/session";
import { isUuid } from "@/lib/ids";
import { getTemplate } from "@/lib/services/templates";
import { getPricing } from "@/lib/services/pricing";

export default async function TemplatePage(props: PageProps<"/templates/[templateId]">) {
  const auth = await requireAuth();
  const { templateId } = await props.params;
  if (!isUuid(templateId)) notFound();
  const [t, pricing] = await Promise.all([getTemplate(auth.orgId, templateId), getPricing()]);
  if (!t) notFound();
  return (
    <>
      <PageHeader title={t.name} back={{ href: "/templates", label: "Templates" }} description="Changes apply to new interviews only; existing interviews keep the structure they started with." />
      <TemplateEditor templateId={t.id} canWrite={can(auth.role, "template:write")} rule={{ minutesPerInterview: pricing.minutesPerInterview, maxMinutes: pricing.maxMinutes }} initial={{
        name: t.name,
        description: t.description,
        sections: t.sections.map((s) => ({
          key: s.id, name: s.name, description: s.description, objective: s.objective, instructions: s.instructions,
          duration_minutes: s.duration_minutes, min_questions: s.min_questions, max_questions: s.max_questions, max_followups: s.max_followups,
          evaluation_criteria: s.evaluation_criteria, scoring_enabled: s.scoring_enabled, enabled: s.enabled,
        })),
      }} />
    </>
  );
}
