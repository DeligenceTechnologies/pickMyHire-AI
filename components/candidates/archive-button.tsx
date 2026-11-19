"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAction } from "@/lib/client/use-action";
import { cn } from "@/lib/utils";

const REASONS = ["Budget", "Location", "Not interested", "Not a fit", "Hired elsewhere", "Other"];

/** Archive a candidate with a reason, or restore an archived one. `compact` shows only the icon. */
export function ArchiveButton({ id, name, archived, compact = false }: { id: string; name: string; archived: boolean; compact?: boolean }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [other, setOther] = useState("");
  if (archived) {
    return (
      <Button variant="outline" size={compact ? "sm" : "default"} disabled={!!pending} className="relative z-10"
        onClick={() => run("restore", `/api/candidates/${id}/archive`, { method: "DELETE", success: `${name} is back in the active list` })}>
        {pending ? <Loader2 className="animate-spin" /> : <ArchiveRestore />} Restore
      </Button>
    );
  }
  const final = reason === "Other" ? (other.trim() ? `Other: ${other.trim()}` : "") : reason;
  return (
    <>
      <Button variant={compact ? "ghost" : "outline"} size={compact ? "icon-sm" : "default"} aria-label={`Archive ${name}`} title="Archive"
        className="relative z-10" onClick={() => { setReason(""); setOther(""); setOpen(true); }}>
        <Archive />{!compact && " Archive"}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Archive {name}?</DialogTitle>
            <DialogDescription>They leave the active candidate list. Nothing is deleted, and you can restore them anytime. Inviting them again also brings them back.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm font-medium">Reason</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Reason">
              {REASONS.map((r) => (
                <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => setReason(r)}
                  className={cn("rounded-full border px-3 py-1.5 text-sm", reason === r ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-muted")}>{r}</button>
              ))}
            </div>
            {reason === "Other" && <Input autoFocus maxLength={150} placeholder="What's the reason?" value={other} onChange={(e) => setOther(e.target.value)} aria-label="Other reason" />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={!!pending}>Cancel</Button>
            <Button disabled={!final || !!pending} onClick={async () => {
              if (await run("archive", `/api/candidates/${id}/archive`, { body: { reason: final }, success: `${name} archived` })) setOpen(false);
            }}>{pending && <Loader2 className="animate-spin" />}Archive</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
