"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Pick } from "@/components/common/list-controls";

/** URL-driven search + filter controls (server components read searchParams). */
export function SearchBar({ placeholder, filters = [] }: { placeholder: string; filters?: { name: string; label: string; options: { value: string; label: string }[] }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");

  const push = (patch: Record<string, string>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    router.replace(`${pathname}?${next.toString()}`);
  };

  useEffect(() => {
    const t = setTimeout(() => { if ((sp.get("q") ?? "") !== q) push({ q }); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="relative flex-1 sm:max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="h-9 pl-8" aria-label="Search" />
      </div>
      {filters.map((f) => (
        <Pick key={f.name} label={f.label} value={sp.get(f.name) ?? ""} onChange={(v) => push({ [f.name]: v })} className="h-9"
          options={[["", f.label], ...f.options.map((o) => [o.value, o.label] as [string, string])]} />
      ))}
    </div>
  );
}
