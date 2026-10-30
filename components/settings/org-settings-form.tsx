"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/client/api";
import { FormCard } from "./form-card";

type Settings = { interviewer_name: string; invite_expiry_days: number; show_scores: boolean; notify_on_completion: boolean; candidate_feedback_email: boolean };

export function OrgSettingsForm({ orgName, settings, canEdit, ai }: { orgName: string; settings: Settings; canEdit: boolean; ai: { live: boolean; models: Record<string, string> } }) {
  const router = useRouter();
  const [name, setName] = useState(orgName);
  const [s, setS] = useState(settings);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <FormCard title="Workspace & interviewer" description="How your company and AI interviewer appear to candidates."
        footer={canEdit && <Button disabled={busy} onClick={async () => {
          setBusy(true);
          try { await api("/api/organizations", { method: "PATCH", body: { name, settings: s } }); toast.success("Settings saved"); router.refresh(); }
          catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
        }}>{busy && <Loader2 className="animate-spin" />}Save changes</Button>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="o-name" required>Company name</Label><Input id="o-name" value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="o-int" required>AI interviewer name</Label><Input id="o-int" value={s.interviewer_name} disabled={!canEdit} onChange={(e) => setS({ ...s, interviewer_name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="o-exp" required>Invitation link validity (days)</Label><Input id="o-exp" type="number" min={1} max={90} value={s.invite_expiry_days} disabled={!canEdit} onChange={(e) => setS({ ...s, invite_expiry_days: Math.max(1, Math.min(90, Number(e.target.value) || 1)) })} /></div>
        </div>
        <label className="flex items-start gap-3 text-sm"><Switch checked={s.show_scores} disabled={!canEdit} onCheckedChange={(c) => setS({ ...s, show_scores: !!c })} /><span><span className="font-medium">Show 1–5 section scores</span><br /><span className="text-muted-foreground">Only for sections where scoring is enabled in the template. Scores are evidence summaries, never hiring decisions.</span></span></label>
        <label className="flex items-start gap-3 text-sm"><Switch checked={s.notify_on_completion} disabled={!canEdit} onCheckedChange={(c) => setS({ ...s, notify_on_completion: !!c })} /><span><span className="font-medium">Email recruiters when an interview completes</span></span></label>
        <label className="flex items-start gap-3 text-sm"><Switch checked={s.candidate_feedback_email} disabled={!canEdit} onCheckedChange={(c) => setS({ ...s, candidate_feedback_email: !!c })} /><span><span className="font-medium">Email candidates AI feedback after their interview</span><br /><span className="text-muted-foreground">Candidates always get a short confirmation once their interview is processed. When this is on, it also includes a few lines of AI feedback from their report: strengths and one area to build on, labelled as AI-generated, with no scores or hiring outcome.</span></span></label>
      </FormCard>
      <FormCard title="AI configuration" description="Models are configured server-side (lib/ai/config.ts or OPENAI_MODEL_* environment variables).">
        <p className="text-sm">
          Status: {ai.live ? <span className="font-medium text-emerald-700 dark:text-emerald-400">Live — OpenAI connected</span> : <span className="font-medium text-amber-700 dark:text-amber-400">Demo mode — set OPENAI_API_KEY in .env.local and restart the server</span>}
        </p>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">{Object.entries(ai.models).map(([k, v]) => <div key={k} className="flex justify-between gap-2 rounded-lg bg-muted/50 px-3 py-1.5"><dt className="text-muted-foreground">{k}</dt><dd className="font-mono text-xs">{v}</dd></div>)}</dl>
      </FormCard>
    </>
  );
}
