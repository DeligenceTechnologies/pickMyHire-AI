"use client";

import { useState } from "react";
import { CalendarClock, CalendarDays, CheckCircle2, Copy, Loader2, RotateCcw, UserX, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/lib/client/use-action";
import type { HumanStatus } from "@/lib/hiring";
import { ScheduleDialog, type PanelMember, type ScheduleValues } from "./schedule-dialog";

/** Invite sharing (always) and schedule management (for people who can manage interviews). */
export function HumanActions({ id, status, candidateName, roundName, inviteText, schedule, members, emailLive, canManage }: {
  id: string; status: HumanStatus; candidateName: string; roundName: string; inviteText: string; schedule: ScheduleValues;
  members: PanelMember[]; emailLive: boolean; canManage: boolean;
}) {
  const { run, pending } = useAction();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  const outcome = (s: "completed" | "no_show" | "scheduled", msg: string) => run(s, `/api/human-interviews/${id}`, { method: "PATCH", body: { action: "outcome", status: s }, success: msg });
  const copy = async () => {
    await navigator.clipboard.writeText(inviteText).then(() => toast.success("Invite copied. Paste it into an email or message"), () => toast.error("Couldn't copy. Select the text instead"));
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {status !== "cancelled" && <Button variant="outline" size="sm" onClick={copy}><Copy /> Copy invite</Button>}
        <a className={buttonVariants({ variant: "outline", size: "sm" })} href={`/api/human-interviews/${id}/calendar?for=candidate`}><CalendarDays /> Calendar file (candidate)</a>
        <a className={buttonVariants({ variant: "outline", size: "sm" })} href={`/api/human-interviews/${id}/calendar?for=team`}><CalendarDays /> Calendar file (team)</a>
      </div>
      {canManage && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          {status === "scheduled" && (
            <>
              <ScheduleDialog mode={{ kind: "reschedule", id, candidateName, roundName, initial: schedule }} members={members} emailLive={emailLive}
                trigger={(open) => <Button size="sm" variant="outline" onClick={open}><CalendarClock /> Reschedule</Button>} />
              <Button size="sm" variant="outline" disabled={!!pending} onClick={() => outcome("completed", "Marked as completed")}><CheckCircle2 /> Mark completed</Button>
              <Button size="sm" variant="outline" disabled={!!pending} onClick={() => outcome("no_show", "Marked as no-show")}><UserX /> No-show</Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { setReason(""); setNotify(true); setCancelling(true); }}><XCircle /> Cancel interview</Button>
            </>
          )}
          {(status === "completed" || status === "no_show") && (
            <Button size="sm" variant="ghost" disabled={!!pending} onClick={() => outcome("scheduled", "Back to scheduled")}><RotateCcw /> Undo: back to scheduled</Button>
          )}
        </div>
      )}
      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel the {roundName} interview?</DialogTitle>
            <DialogDescription>{candidateName}&apos;s interview is cancelled; the calendar file updates to remove it. You can schedule a new one any time.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason" required>Reason</Label>
            <Textarea id="cancel-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Position filled, candidate withdrew" />
          </div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={notify} onCheckedChange={(c) => setNotify(!!c)} /> Email the candidate and interviewers</label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(false)}>Keep interview</Button>
            <Button variant="destructive" disabled={!reason.trim() || !!pending}
              onClick={async () => { const ok = await run("cancel", `/api/human-interviews/${id}`, { method: "PATCH", body: { action: "cancel", reason: reason.trim(), sendEmail: notify }, success: "Interview cancelled", emailFix: "Let them know yourself that it's cancelled." }); if (ok) setCancelling(false); }}>
              {pending === "cancel" && <Loader2 className="animate-spin" />} Cancel interview
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
