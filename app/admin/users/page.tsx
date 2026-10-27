import Link from "next/link";
import { ShieldCheck, Users } from "lucide-react";
import { UserActions } from "@/components/admin/user-actions";
import { PageHeader } from "@/components/common/page-header";
import { SearchBar } from "@/components/common/search-bar";
import { EmptyState } from "@/components/common/states";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { roleLabel } from "@/lib/auth/permissions";
import { formatDate, timeAgo } from "@/lib/format";
import { listUsers } from "@/lib/services/admin";

export const metadata = { title: "Users" };

export default async function UsersPage(props: PageProps<"/admin/users">) {
  const admin = await requirePlatformAdmin();
  const sp = await props.searchParams;
  const users = await listUsers(typeof sp.q === "string" ? sp.q : undefined);
  return (
    <>
      <PageHeader title="Users" description="Everyone with an account, across all companies." />
      <div className="mb-4"><SearchBar placeholder="Search name or email…" /></div>
      {users.length === 0 ? <EmptyState icon={Users} title="No users found" /> : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr><th className="px-4 py-2.5 font-medium">User</th><th className="px-4 py-2.5 font-medium">Companies</th><th className="px-4 py-2.5 font-medium">Last active</th><th className="px-4 py-2.5 font-medium">Joined</th><th className="px-4 py-2.5"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody className="divide-y">
              {users.map((u) => (
                <tr key={u.id} className={u.disabled_at ? "bg-red-50/40 dark:bg-red-950/20" : undefined}>
                  <td className="px-4 py-3">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {u.name}
                      {u.is_platform_admin && <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"><ShieldCheck className="size-3" /> Platform admin</span>}
                      {u.disabled_at && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-300">Disabled</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    {u.companies.length === 0 ? <span className="text-muted-foreground">—</span> : (
                      <ul className="space-y-0.5">
                        {u.companies.map((c) => (
                          <li key={c.id}><Link href={`/admin/companies/${c.id}`} className="hover:text-primary">{c.name}</Link> <span className="text-xs text-muted-foreground">· {roleLabel[c.role]}{c.status === "suspended" ? " · suspended" : ""}</span></li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{u.last_seen_at ? timeAgo(u.last_seen_at) : "Never"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(u.created_at)}</td>
                  <td className="px-4 py-3 text-right"><UserActions id={u.id} name={u.name} email={u.email} disabled={!!u.disabled_at} isSelf={u.id === admin.userId} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
