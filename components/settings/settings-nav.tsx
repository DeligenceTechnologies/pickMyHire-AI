"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function SettingsNav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto lg:flex-col">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={cn("rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap", pathname === i.href || pathname.startsWith(`${i.href}/`) ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
