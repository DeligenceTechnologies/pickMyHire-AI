"use client";
import Link from "next/link";

import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { DEMO_URL } from "@/lib/marketing";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/#demo", label: "Demo" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#features", label: "Features" },
  { href: "/#team", label: "For teams" },
  { href: "/#why", label: "Why us" },
  { href: "/#trust", label: "Trust" },
  { href: "/#faq", label: "FAQ" },
  { href: "/guide", label: "Guide" },
];

/**
 * `trial`: free trials are open, so "Start free trial" is the main button.
 * `app`: the visitor is signed in, so the main button goes back to the app.
 */
export function SiteHeader({ trial = false, app = null }: { trial?: boolean; app?: { href: string; label: string } | null }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-[#E3EAF5]/80 bg-[#F8FAFD]/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:gap-6 sm:px-8">
        <Link href="/" aria-label="PickMyHire.ai home" className="shrink-0">
          <Logo height={26} className="sm:h-8!" />
        </Link>
        <nav className="hidden flex-1 items-center justify-center gap-6 text-sm font-medium whitespace-nowrap xl:gap-7 text-[#3D4D6A] lg:flex" aria-label="Main">
          {NAV.map((n) => <a key={n.href} href={n.href} className="hover:text-[#0B5BD3]">{n.label}</a>)}
        </nav>
        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          {app ? (
            <>
              <Link href={app.href} className="inline-flex rounded-lg bg-[#0B5BD3] px-4 py-2 text-sm font-semibold whitespace-nowrap text-white shadow-sm hover:bg-[#0A4FB8]">{app.label}</Link>
            </>
          ) : trial ? (
            <>
              <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="hidden rounded-lg border border-[#CBD7EA] bg-white px-4 py-2 text-sm font-semibold whitespace-nowrap text-[#0F1F3A] hover:border-[#0B5BD3] hover:text-[#0B5BD3] sm:inline-flex">Book a demo</a>
              <Link href="/signup" className="inline-flex rounded-lg bg-[#0B5BD3] px-4 py-2 text-sm font-semibold whitespace-nowrap text-white shadow-sm hover:bg-[#0A4FB8]">Start free trial</Link>
            </>
          ) : (
            <>
              <Link href="/#contact" className="hidden rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap text-[#0F1F3A] hover:bg-[#E9F0FB] sm:inline-flex">Contact us</Link>
              <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex rounded-lg bg-[#0B5BD3] px-4 py-2 text-sm font-semibold whitespace-nowrap text-white shadow-sm hover:bg-[#0A4FB8]">
                Book a demo
              </a>
            </>
          )}
          <button type="button" className="rounded-lg p-2 text-[#0F1F3A] hover:bg-[#E9F0FB] lg:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>
      <div className={cn("border-t border-[#E3EAF5] bg-[#F8FAFD] px-5 py-3 lg:hidden", !open && "hidden")}>
        <nav className="flex flex-col" aria-label="Mobile">
          {NAV.map((n) => <a key={n.href} href={n.href} onClick={() => setOpen(false)} className="rounded-lg px-2 py-2.5 text-sm font-medium text-[#0F1F3A] hover:bg-[#E9F0FB]">{n.label}</a>)}
          {app
            ? <Link href="/help" onClick={() => setOpen(false)} className="rounded-lg px-2 py-2.5 text-sm font-medium text-[#0F1F3A] hover:bg-[#E9F0FB]">Help and support</Link>
            : <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="rounded-lg px-2 py-2.5 text-sm font-medium text-[#0F1F3A] hover:bg-[#E9F0FB]">Book a demo</a>}
        </nav>
      </div>
    </header>
  );
}
