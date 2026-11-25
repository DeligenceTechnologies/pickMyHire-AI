import { FormCard } from "@/components/settings/form-card";
import { requireAuth } from "@/lib/auth/session";
import { listAudit } from "@/lib/services/workspace";
import { LocalTime } from "@/components/common/local-time";

export const metadata = { title: "Audit log" };

export default async function AuditPage(props: PageProps<"/settings/audit">) {
  const auth = await requireAuth("audit:view");
  const sp = await props.searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const rows = await listAudit(auth.orgId, page);
  return (
    <FormCard title="Audit log" description="Security-relevant and interview lifecycle events. Most recent first.">
      <div className="-mx-5 -my-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="px-5 py-2 font-medium">When</th><th className="px-5 py-2 font-medium">Actor</th><th className="px-5 py-2 font-medium">Action</th><th className="px-5 py-2 font-medium">Entity</th></tr></thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-5 py-2 whitespace-nowrap text-muted-foreground"><LocalTime date={r.created_at} /></td>
                <td className="px-5 py-2">{r.user_name ?? <span className="capitalize text-muted-foreground">{r.actor_type}</span>}</td>
                <td className="px-5 py-2 font-mono text-xs">{r.action}</td>
                <td className="px-5 py-2 text-muted-foreground">{r.entity_type}{r.entity_type === "interview" && r.entity_id ? <a className="ml-1 text-primary hover:underline" href={`/interviews/${r.entity_id}`}>open</a> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No events.</p>}
        <div className="flex justify-between border-t px-5 py-3 text-sm">
          {page > 1 ? <a href={`?page=${page - 1}`} className="text-primary hover:underline">Newer</a> : <span />}
          {rows.length === 50 && <a href={`?page=${page + 1}`} className="text-primary hover:underline">Older</a>}
        </div>
      </div>
    </FormCard>
  );
}
