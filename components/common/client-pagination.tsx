"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export const LIST_PAGE_SIZE = 20;

/** Pages a list that's already in the browser. Changing `resetKey` (e.g. the filters) goes back to page 1. */
export function usePaged<T>(items: T[], resetKey: string, pageSize = LIST_PAGE_SIZE) {
  const [state, setState] = useState({ page: 1, key: resetKey });
  // Back to page 1 when the filters change (React's "adjust state while rendering" pattern).
  if (state.key !== resetKey) setState({ page: 1, key: resetKey });
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  // Stay in range if the list shrinks.
  const page = state.key !== resetKey ? 1 : Math.min(state.page, pages);
  const setPage = (p: number) => setState({ page: p, key: resetKey });
  return { page, pages, setPage, pageSize, total: items.length, rows: items.slice((page - 1) * pageSize, page * pageSize) };
}

/** "1–20 of 64" with Previous / Next, matching the server-side Pagination. Hidden when everything fits on one page. */
export function ClientPagination({ page, pages, pageSize, total, setPage }: { page: number; pages: number; pageSize: number; total: number; setPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
      <span className="tabular">{(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total}</span>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
        <Button type="button" variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}
