"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/client/api";

export function ConsentScreen({ token, company, version, minutes, faceVerification }: { token: string; company: string; version: string; minutes: number | null; faceVerification: boolean }) {
  const router = useRouter();
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Before we start</h1>
      <p className="mt-2 text-muted-foreground">Please review how your interview will be recorded and used.</p>
      <div className="mt-6 space-y-4 rounded-xl border bg-card p-6 text-sm leading-relaxed">
        <section><h2 className="font-semibold">What happens</h2><p className="text-muted-foreground">You&apos;ll have a voice conversation with an AI interviewer{minutes ? ` lasting about ${minutes} minutes` : ""}. It asks prepared questions based on the role and your resume, and may ask follow-up questions.</p></section>
        <section><h2 className="font-semibold">Recording</h2><p className="text-muted-foreground">Your camera video and microphone audio, and the interviewer&apos;s voice, are recorded and stored privately for {company}&apos;s hiring team.</p></section>
        <section><h2 className="font-semibold">AI processing</h2><p className="text-muted-foreground">Your speech is transcribed and analyzed by AI (provided by OpenAI) to guide follow-up questions and to summarize job-relevant evidence from your answers. AI does not assess your appearance, accent or emotions, and it does not make hiring decisions — people at {company} review your interview and decide.</p></section>
        {faceVerification && (
          <section><h2 className="font-semibold">Identity check</h2><p className="text-muted-foreground">Before you start, we take a photo of you. During the interview, your device compares your face with that photo every few seconds to confirm it&apos;s still you, and takes a few more photos, including when no face, another person or a different face is seen. Face comparison runs on your device; only the photos and a numerical face template are stored. Nothing is decided automatically: {company}&apos;s hiring team reviews any flags. These photos are deleted together with your interview recording.</p></section>
        )}
        <section><h2 className="font-semibold">Your data</h2><p className="text-muted-foreground">Recordings, transcripts and summaries are only accessible to authorized members of {company}&apos;s hiring team and are kept according to their data-retention policy. You can ask {company} to delete your data. See how PickMyHire.ai handles your data in our <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">Privacy Policy</a>.</p></section>
      </div>
      <label className="mt-6 flex items-start gap-3 text-sm">
        <Checkbox checked={agree} onCheckedChange={(c) => setAgree(!!c)} className="mt-0.5" />
        <span>I agree to my interview being recorded, transcribed and analyzed by AI{faceVerification ? ", and to the identity check," : ""} as described above.</span>
      </label>
      {error && <p role="alert" className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <Button size="lg" className="mt-6 h-11 px-6" disabled={!agree || busy} onClick={async () => {
        setBusy(true);
        setError(null);
        try {
          await api(`/api/public/interview/${token}/consent`, { body: { consent: true, version } });
          router.push(`/interview/${token}/device-check`);
        } catch (e) { setError((e as Error).message); setBusy(false); }
      }}>{busy && <Loader2 className="animate-spin" />}I agree — continue</Button>
    </div>
  );
}
