"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * A PDF drawn page by page at the full width available, so a resume is easy to read in any browser,
 * including phones (which often can't show a PDF inside a page). The PDF engine loads only when needed.
 */
export function PdfPages({ url, title }: { url: string; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;
    const holder = box.current;
    (async () => {
      try {
        const [{ getDocumentProxy }, res] = await Promise.all([import("unpdf"), fetch(url, { credentials: "same-origin" })]);
        if (!res.ok) throw new Error(String(res.status));
        const pdf = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()));
        if (cancelled || !holder) return;
        holder.replaceChildren();
        // Up to the width of a readable page; sharp on high-resolution screens.
        const width = Math.min(holder.clientWidth - 32, 900);
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        for (let n = 1; n <= Math.min(pdf.numPages, 20); n++) {
          const page = await pdf.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * ratio });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
          canvas.setAttribute("aria-label", `${title}, page ${n} of ${pdf.numPages}`);
          canvas.className = "mx-auto block rounded-sm bg-white shadow-md ring-1 ring-black/5";
          holder.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext("2d")!, viewport, canvas } as Parameters<typeof page.render>[0]).promise;
          if (n === 1 && !cancelled) setState("ready");
        }
        if (!cancelled) setState("ready");
      } catch {
        if (!cancelled) setState("failed");
      }
    })();
    return () => { cancelled = true; };
  }, [url, title]);

  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto bg-muted/70 py-4">
      {state === "loading" && <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Opening the resume…</p>}
      {state === "failed" && (
        <p className="px-6 py-16 text-center text-sm text-muted-foreground">
          The resume couldn&apos;t be shown here. <a href={url} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">Open it in a new tab</a> or download it.
        </p>
      )}
      <div ref={box} className="space-y-4 px-4" />
    </div>
  );
}
