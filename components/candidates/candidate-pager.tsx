"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Pager } from "@/components/common/list-controls";

/** The Candidates page's pages and rows per page, kept in the address like its other filters. */
export function CandidatePager({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const go = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) if (v) q.set(k, v); else q.delete(k);
    router.push(q.size ? `${pathname}?${q}` : pathname, { scroll: false });
  };
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <Pager page={Math.min(page, pages)} pages={pages} total={total} pageSize={pageSize}
      setPage={(p) => go({ page: p > 1 ? String(p) : undefined })}
      setPageSize={(n) => go({ size: n !== 5 ? String(n) : undefined, page: undefined })} />
  );
}
