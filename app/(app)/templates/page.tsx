import Link from "next/link";
import { Clock, FileStack, Layers } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/states";
import { can } from "@/lib/auth/permissions";
import { requireAuth } from "@/lib/auth/session";
import { timeAgo } from "@/lib/format";
import { listTemplates } from "@/lib/services/templates";
import { getPricing } from "@/lib/services/pricing";
import { interviewsFor } from "@/lib/pricing";

export const metadata = { title: "Interview templates" };

export default async function TemplatesPage() {
  const auth = await requireAuth();
  const [templates, pricing] = await Promise.all([listTemplates(auth.orgId), getPricing()]);
  return (
    <>
      <PageHeader title="Interview templates" description="Reusable interview structures: sections, timing, question counts and evaluation criteria."
        actions={can(auth.role, "template:write") && <Link href="/templates/new" className={buttonVariants()}>New template</Link>} />
      {templates.length === 0 ? <EmptyState icon={FileStack} title="No templates" description="Create a template to structure your interviews." /> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => (
            <Link key={t.id} href={`/templates/${t.id}`} className="group rounded-xl border bg-card p-5 hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold group-hover:text-primary">{t.name}</h3>
                {t.is_default && <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">Default</span>}
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{t.description || "No description"}</p>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs whitespace-nowrap text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Layers className="size-3.5" />{t.section_count} sections</span>
                <span className="inline-flex items-center gap-1"><Clock className="size-3.5" />{t.total_minutes} min</span>
                {interviewsFor(t.total_minutes, pricing) > 1 && <span className="rounded-full bg-amber-50 px-1.5 font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">Counts as {interviewsFor(t.total_minutes, pricing)}</span>}
                <span>{t.job_count} jobs</span>
                <span className="ml-auto">{timeAgo(t.updated_at)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
