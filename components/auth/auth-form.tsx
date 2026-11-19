"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ClientApiError } from "@/lib/client/api";

export type Field = { name: string; label: string; type?: string; autoComplete?: string; placeholder?: string; defaultValue?: string; readOnly?: boolean; hint?: string; optional?: boolean };

export function AuthForm({ fields, submitLabel, endpoint, extra, onSuccess, note }: {
  fields: Field[];
  /** Small print under the button (e.g. the terms you agree to). */
  note?: React.ReactNode;
  submitLabel: string;
  endpoint: string;
  extra?: Record<string, string | boolean | undefined>;
  onSuccess: (res: Record<string, unknown>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        setFieldErrors({});
        const data = Object.fromEntries(new FormData(e.currentTarget).entries());
        try {
          const res = await api<Record<string, unknown>>(endpoint, { body: { ...data, ...Object.fromEntries(Object.entries(extra ?? {}).filter(([, v]) => v)) } });
          onSuccess(res);
        } catch (err) {
          const e2 = err as ClientApiError;
          if (e2.issues?.length) setFieldErrors(Object.fromEntries(e2.issues.map((i) => [i.path, i.message])));
          setError(e2.message);
          setBusy(false);
        }
      }}
    >
      {fields.map((f) => (
        <div key={f.name} className="space-y-1.5">
          <Label htmlFor={f.name} required={!f.optional}>{f.label}{f.optional && <span className="font-normal text-muted-foreground"> (optional)</span>}</Label>
          <Input id={f.name} name={f.name} required={!f.optional} type={f.type ?? "text"} autoComplete={f.autoComplete} placeholder={f.placeholder}
            defaultValue={f.defaultValue} readOnly={f.readOnly} aria-invalid={!!fieldErrors[f.name]} className="h-10" />
          {fieldErrors[f.name] ? <p className="text-xs text-destructive">{fieldErrors[f.name]}</p> : f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
        </div>
      ))}
      {error && !Object.keys(fieldErrors).length && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <Button type="submit" className="h-10 w-full" disabled={busy}>
        {busy && <Loader2 className="animate-spin" />} {submitLabel}
      </Button>
      {note && <p className="text-center text-xs leading-relaxed text-muted-foreground">{note}</p>}
    </form>
  );
}
