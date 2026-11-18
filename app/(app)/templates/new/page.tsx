import { PageHeader } from "@/components/common/page-header";
import { TemplateEditor } from "@/components/templates/template-editor";
import { requireAuth } from "@/lib/auth/session";
import { getPricing } from "@/lib/services/pricing";

export const metadata = { title: "New template" };

export default async function NewTemplatePage() {
  await requireAuth("template:write");
  const pricing = await getPricing();
  return (
    <>
      <PageHeader title="New interview template" back={{ href: "/templates", label: "Templates" }} />
      <TemplateEditor canWrite rule={{ minutesPerInterview: pricing.minutesPerInterview, maxMinutes: pricing.maxMinutes }} />
    </>
  );
}
