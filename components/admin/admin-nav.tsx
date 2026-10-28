"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Inbox, LayoutDashboard, LifeBuoy, ScrollText, Settings, Ticket, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/requests", label: "Inquiries", icon: Inbox },
  { href: "/admin/support", label: "Support", icon: LifeBuoy },
  { href: "/admin/companies", label: "Companies", icon: Building2 },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/coupons", label: "Coupons", icon: Ticket },
  { href: "/admin/settings", label: "Settings", icon: Settings },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
];

/** Vertical on desktop, a scrollable row of tabs on small screens. */
export function AdminNav({ newRequests, supportWaiting }: { newRequests: number; supportWaiting: number }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-0.5 lg:overflow-visible" aria-label="Admin">
      {NAV.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
            {(() => {
              const n = href === "/admin/requests" ? newRequests : href === "/admin/support" ? supportWaiting : 0;
              return n > 0 && <span className="ml-auto rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular">{n}</span>;
            })()}
          </Link>
        );
      })}
    </nav>
  );
}
