"use client";

import { useRef, useState } from "react";
import { CheckCircle2, FileText, Loader2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { validateAnswers, type ApplicationForm } from "@/lib/application-form";
import { emptyValues, pruneErrors, QuestionFields, type AnswerValues } from "@/components/applications/question-fields";

export function ApplyForm({ slug, company, jobTitle, form: questions }: { slug: string; company: string; jobTitle: string; form: ApplicationForm }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<AnswerValues>(emptyValues);
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});
  const hasQuestions = Object.values(questions.standard).some((q) => q.enabled) || questions.custom.length > 0;

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return setError("Resume files must be 10 MB or smaller.");
    if (!/\.(pdf|docx|txt)$/i.test(f.name)) return setError("Please upload a PDF, DOCX or TXT file.");
    setError(null);
    setFile(f);
  };

  if (done) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center">
        <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
        <h2 className="mt-4 text-xl font-semibold">Application submitted</h2>
        <p className="mt-2 text-sm text-muted-foreground">Thank you for applying for {jobTitle}. We&apos;ve emailed you a confirmation. The {company} hiring team will be in touch if your background is a match.</p>
      </div>
    );
  }

  return (
    <form
      className="space-y-4 rounded-xl border bg-card p-6"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setFieldErrors({});
        setAnswerErrors({});
        const checked = validateAnswers(questions, answers);
        if (Object.keys(checked.errors).length) {
          setAnswerErrors(checked.errors);
          return setError("Please answer the required questions in the right format.");
        }
        if (!file) return setError("Please attach your resume.");
        const fd = new FormData(e.currentTarget);
        fd.set("resume", file);
        fd.set("consent", consent ? "true" : "false");
        fd.set("answers", JSON.stringify(answers));
        setBusy(true);
        try {
          const res = await fetch(`/api/public/apply/${slug}`, { method: "POST", body: fd });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            if (data.issues) {
              const issues = data.issues as { path: string; message: string }[];
              setFieldErrors(Object.fromEntries(issues.filter((i) => !i.path.startsWith("answers.")).map((i) => [i.path, i.message])));
              setAnswerErrors(Object.fromEntries(issues.filter((i) => i.path.startsWith("answers.")).map((i) => [i.path.slice(8), i.message])));
            }
            throw new Error(data.error ?? "Something went wrong. Please try again.");
          }
          setDone(true);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <h2 className="text-lg font-semibold">Apply for this role</h2>
        <p className="mt-1 text-xs text-muted-foreground">Fields marked <span className="text-destructive">*</span> are required.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {([
          ["name", "Full name", "text", "name", true],
          ["email", "Email", "email", "email", true],
          ["phone", "Phone", "tel", "tel", false],
          ["linkedin_url", "LinkedIn profile", "url", "url", false],
        ] as const).map(([name, label, type, ac, req]) => (
          <div key={name} className="space-y-1.5">
            <Label htmlFor={`ap-${name}`} required={req}>{label}{!req && <span className="font-normal text-muted-foreground"> (optional)</span>}</Label>
            <Input id={`ap-${name}`} name={name} required={req} type={type} autoComplete={ac} placeholder={name === "linkedin_url" ? "https://linkedin.com/in/…" : undefined} aria-invalid={!!fieldErrors[name]} />
            {fieldErrors[name] && <p className="text-xs text-destructive">{fieldErrors[name]}</p>}
          </div>
        ))}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ap-resume" required>Resume</Label>
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
          onClick={() => fileInput.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInput.current?.click(); }}
          className={cn("flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-6 text-center transition-colors", drag ? "border-primary bg-accent" : "bg-muted/30 hover:bg-muted/50")}
        >
          {file ? <FileText className="size-6 text-primary" /> : <UploadCloud className="size-6 text-muted-foreground" />}
          <p className="mt-2 text-sm font-medium">{file ? file.name : "Upload your resume"}</p>
          <p className="text-xs text-muted-foreground">{file ? "Click to replace" : "Drag & drop or click · PDF, DOCX or TXT up to 10 MB"}</p>
        </div>
        <input ref={fileInput} id="ap-resume" type="file" accept=".pdf,.docx,.txt" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      {hasQuestions && (
        <fieldset className="space-y-3 border-t pt-4">
          <legend className="sr-only">Questions about the role</legend>
          <p className="text-sm font-medium">A few questions about the role</p>
          <QuestionFields form={questions} values={answers} onChange={(v) => { setAnswerErrors((e) => pruneErrors(e, answers, v)); setAnswers(v); }} errors={answerErrors} idPrefix="ap-q" />
        </fieldset>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="ap-note">Anything you&apos;d like us to know? <span className="font-normal text-muted-foreground">(optional)</span></Label>
        <Textarea id="ap-note" name="cover_note" rows={4} maxLength={3000} />
      </div>
      {/* Honeypot: hidden from people, filled by bots. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      <label className="flex items-start gap-3 text-sm">
        <Checkbox checked={consent} onCheckedChange={(c) => setConsent(!!c)} className="mt-0.5" />
        <span className="text-muted-foreground">
          <span aria-hidden="true" className="mr-0.5 text-destructive">*</span>I agree that {company} may store my application and use AI to compare my resume with this role&apos;s requirements. People on the hiring team review every application and make all decisions.
        </span>
      </label>
      {fieldErrors.consent && <p className="text-xs text-destructive">{fieldErrors.consent}</p>}
      {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <Button type="submit" size="lg" className="h-11 w-full" disabled={busy || !consent}>
        {busy && <Loader2 className="animate-spin" />} Submit application
      </Button>
    </form>
  );
}
