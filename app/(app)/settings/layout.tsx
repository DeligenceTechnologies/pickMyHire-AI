import { PageHeader } from "@/components/common/page-header";
import { SettingsNav } from "@/components/settings/settings-nav";
import { can } from "@/lib/auth/permissions";
import { requireAuth } from "@/lib/auth/session";

export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const auth = await requireAuth();
  const items = [
    { href: "/settings/profile", label: "Profile" },
    { href: "/settings/team", label: "Team" },
    { href: "/settings/interview", label: "Interview" },
    ...(can(auth.role, "branding:manage") ? [{ href: "/settings/branding", label: "Branding" }] : []),
    ...(can(auth.role, "privacy:manage") ? [{ href: "/settings/privacy", label: "Privacy & data" }] : []),
    ...(can(auth.role, "billing:manage") ? [{ href: "/settings/billing", label: "Billing" }] : []),
    ...(can(auth.role, "usage:view") ? [{ href: "/settings/usage", label: "Usage" }] : []),
    ...(can(auth.role, "audit:view") ? [{ href: "/settings/audit", label: "Audit log" }] : []),
    ...(can(auth.role, "interview:write") ? [{ href: "/settings/notifications", label: "Email outbox" }] : []),
  ];
  return (
    <>
      <PageHeader title="Settings" description={`Manage ${auth.orgName}.`} />
      <div className="grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
        <SettingsNav items={items} />
        <div className="min-w-0 space-y-6">{children}</div>
      </div>
    </>
  );
}
