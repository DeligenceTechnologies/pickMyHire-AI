import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { requireAuth } from "@/lib/auth/session";
import { can, roleLabel } from "@/lib/auth/permissions";
import { aiIsLive } from "@/lib/env";
import { Copyright, Logo } from "@/components/layout/logo";
import { MobileNav } from "@/components/layout/mobile-nav";
import { NotificationBell } from "@/components/layout/notification-bell";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { UserMenu } from "@/components/layout/user-menu";
import { TrialBanner } from "@/components/layout/trial-banner";
import { getQuotaStatus } from "@/lib/services/quota";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const auth = await requireAuth();
  const live = aiIsLive();
  const hiddenNav = can(auth.role, "candidate:view") ? [] : ["/candidates"];
  const quota = await getQuotaStatus(auth.orgId);
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-sidebar px-3 py-4 lg:flex">
        <Link href="/dashboard" className="mb-6 px-2"><Logo height={30} /></Link>
        <SidebarNav hidden={hiddenNav} />
        {auth.isPlatformAdmin && (
          <Link href="/admin" className="mt-4 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-primary hover:bg-muted">
            <ShieldCheck className="size-4" /> Platform admin
          </Link>
        )}
        <div className="mt-auto rounded-lg border bg-muted/40 p-3 text-xs">
          <p className="font-medium text-foreground truncate">{auth.orgName}</p>
          <p className="text-muted-foreground">{roleLabel[auth.role]}</p>
        </div>
        <Copyright className="mt-3 text-center text-[10px] leading-tight" />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur lg:px-8">
          <MobileNav orgName={auth.orgName} hidden={hiddenNav} />
          <div className="flex-1" />
          {!live && (
            <Link href="/settings/interview" className="hidden rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200 sm:inline dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900">
              {auth.isPlatformAdmin ? "Demo mode — add OPENAI_API_KEY to enable live AI" : "AI not connected — please contact support"}
            </Link>
          )}
          <NotificationBell />
          <UserMenu name={auth.name} email={auth.email} role={roleLabel[auth.role]} />
        </header>
        <TrialBanner quota={quota} email={auth.email} />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
