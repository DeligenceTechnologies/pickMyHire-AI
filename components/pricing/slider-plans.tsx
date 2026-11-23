"use client";

import { useState } from "react";
import { ArrowRight, Check, Minus, Plus, Sparkles } from "lucide-react";
import type { PricingAccount } from "@/components/pricing/page-shell";
import { cn } from "@/lib/utils";
import { defaultQty, minPurchase, money, quote, tierFor, type Pricing } from "@/lib/pricing";

type Props = {
  pricing: Pricing;
  trial: { enabled: boolean; interviews: number };
  start: { href: string; label: string };
  packHref: string | null;
  packLabel: string;
  contactHref: string;
  /** The signed-in company's balance (null for visitors). Once free interviews are used up, only buy options show. */
  account?: PricingAccount | null;
  /** Starting number (e.g. the pack chosen on the pricing page). */
  initialQty?: number | null;
  /** In the app (Billing): the button buys straight away instead of linking to sign-up; no free column or features link. */
  onBuy?: (qty: number) => void;
};

/**
 * Option E: one big number and a full-width slider, then three plain columns (Free, Pay per interview, Enterprise)
 * whose middle price follows the slider.
 */
export function SliderPlans({ pricing, trial, start, packHref, packLabel, contactHref, account = null, initialQty = null, onBuy }: Props) {
  const min = minPurchase(pricing);
  const last = pricing.tiers[pricing.tiers.length - 1].min;
  const top = pricing.contactFrom ?? last * 3; // the end of the slider ("250+")
  const [qty, setQty] = useState(initialQty && initialQty >= min ? initialQty : defaultQty(pricing));
  const [typed, setTyped] = useState<string | null>(null);
  const q = quote(qty, pricing);
  const contact = q.contact;
  const set = (n: number) => { setTyped(null); setQty(Math.max(min, Math.min(100_000, Math.round(n || min)))); };
  const href = (n: number) => (packHref ? `${packHref}?pack=${n}` : start.href);

  // The slider gives 60% of its width to min..last (where most people buy), the rest to last..top.
  const SPLIT = 0.6, STEPS = 1000;
  const toPos = (n: number) => (n <= last ? ((n - min) / (last - min)) * SPLIT : SPLIT + ((Math.min(n, top) - last) / (top - last)) * (1 - SPLIT)) * STEPS;
  const fromPos = (p: number) => { const f = p / STEPS; if (f >= 0.98) return top; return f <= SPLIT ? min + (f / SPLIT) * (last - min) : last + ((f - SPLIT) / (1 - SPLIT)) * (top - last); };
  const pos = toPos(qty);
  const marks = [...pricing.tiers.map((t) => ({ n: t.min, label: String(t.min), price: money(t.cents) })),
    ...(pricing.contactFrom ? [{ n: pricing.contactFrom, label: `${pricing.contactFrom}+`, price: "Custom" }] : [])];

  const included = [`AI voice interview, up to ${pricing.advertisedMinutes} minutes`, "Questions from the resume and job, with follow-ups", "Recording, full transcript and AI report", "Compare candidates and human interview rounds", "Unlimited team members and jobs"];
  // Visitors see the free trial; a signed-in company sees it only while it still has free interviews.
  const showFree = onBuy ? false : account ? account.freeLeft > 0 : true;

  return (
    <div>
      <style>{`
        .pmh-range { -webkit-appearance:none; appearance:none; width:100%; height:6px; border-radius:999px; outline:none; cursor:pointer;
          background:linear-gradient(to right,#0B5BD3 0,#0B5BD3 var(--fill),#E3EAF5 var(--fill),#E3EAF5 100%); }
        .pmh-range::-webkit-slider-thumb { -webkit-appearance:none; width:26px; height:26px; border-radius:50%; background:#fff; border:3px solid #0B5BD3;
          box-shadow:0 0 0 5px rgba(11,91,211,.14),0 2px 6px rgba(15,31,58,.2); transition:transform .15s; }
        .pmh-range::-webkit-slider-thumb:hover { transform:scale(1.08); }
        .pmh-range::-moz-range-thumb { width:28px; height:28px; border-radius:50%; background:#fff; border:3px solid #0B5BD3; box-shadow:0 0 0 6px rgba(11,91,211,.14); }
        .pmh-range:focus-visible::-webkit-slider-thumb { box-shadow:0 0 0 8px rgba(11,91,211,.3); }
      `}</style>

      {account && (account.freeUsedUp ? (
        <div role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <b>You&apos;ve used your free interviews.</b> Buy interviews to keep hiring, from <b className="tabular">{money(pricing.tiers[0].cents)}</b> per interview.
        </div>
      ) : account.plan === "standard" && account.remaining !== null ? (
        <p role="status" className="mb-4 text-sm text-[#5B6B86]">Your balance: <b className="text-[#0F1F3A] tabular">{account.remaining}</b> interview{account.remaining === 1 ? "" : "s"} left.</p>
      ) : null)}

      {/* How many */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {!onBuy && <p className="text-sm text-[#5B6B86]">How many interviews do you need?</p>}
          <p className={cn("flex items-baseline gap-2.5 text-[#0F1F3A]", !onBuy && "mt-1")}>
            <span className={cn("font-semibold tracking-tight tabular", onBuy ? "text-4xl" : "text-4xl lg:text-5xl")}>{contact ? `${pricing.contactFrom}+` : q.qty}</span>
            <span className="text-xl font-medium tracking-tight lg:text-2xl">interviews</span>
          </p>
        </div>
        <div className="flex items-center rounded-xl border border-[#CBD7EA] bg-white focus-within:ring-3 focus-within:ring-[#0B5BD3]/25">
          <button type="button" onClick={() => set(qty - 1)} disabled={qty <= min} aria-label="One fewer interview" className="flex size-10 items-center justify-center rounded-l-xl hover:bg-[#F1F6FD] disabled:opacity-40"><Minus className="size-4" /></button>
          <input type="number" inputMode="numeric" min={min} aria-label="Exact number of interviews" value={typed ?? String(qty)}
            onChange={(e) => { setTyped(e.target.value); if (e.target.value !== "") setQty(Math.max(0, Math.min(100_000, Math.floor(Number(e.target.value) || 0)))); }}
            onBlur={() => { setTyped(null); if (qty < min) setQty(min); }}
            className="h-10 w-16 border-x border-[#E3EAF5] bg-transparent text-center font-semibold tabular outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
          <button type="button" onClick={() => set(qty + 1)} aria-label="One more interview" className="flex size-10 items-center justify-center rounded-r-xl hover:bg-[#F1F6FD]"><Plus className="size-4" /></button>
        </div>
      </div>

      {/* Slider */}
      <div className={onBuy ? "mt-3" : "mt-4"}>
        <input type="range" min={0} max={STEPS} step={1} value={pos} onChange={(e) => set(fromPos(Number(e.target.value)))}
          aria-label="Number of interviews" aria-valuetext={contact ? `${pricing.contactFrom} or more interviews` : `${q.qty} interviews`}
          className="pmh-range" style={{ ["--fill" as string]: `${(pos / STEPS) * 100}%` }} />
        <div className="relative mt-2 h-9 text-[13px]">
          {marks.map((m, i) => {
            const left = (toPos(m.n) / STEPS) * 100;
            const on = contact ? i === marks.length - 1 : m.n !== pricing.contactFrom && tierFor(qty, pricing).min === m.n;
            return (
              <button key={m.n} type="button" onClick={() => set(m.n)}
                className={cn("absolute flex flex-col leading-tight transition-colors hover:text-[#0B5BD3]", i === 0 ? "items-start" : i === marks.length - 1 ? "-translate-x-full items-end" : "-translate-x-1/2 items-center", on ? "text-[#0B5BD3]" : "text-[#5B6B86]")}
                style={{ left: `${left}%` }}>
                <span className={cn("font-semibold tabular", on ? "text-[#0B5BD3]" : "text-[#0F1F3A]")}>{m.label}</span>
                <span className="text-[11px] tabular">{m.price}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Three columns: the button sits right under the price, so it's visible without scrolling */}
      <div className={cn(onBuy ? "mt-2" : "mt-4", "grid gap-px overflow-hidden rounded-2xl border border-[#DCE4F0] bg-[#DCE4F0]", showFree ? "md:grid-cols-3" : "md:grid-cols-2")}>
        {/* Free: for visitors, or a signed-in company that still has free interviews */}
        {showFree && (account ? (
          <Col>
            <p className="text-lg font-semibold">Your free trial</p>
            <Price big={String(account.freeLeft)} small={`free interview${account.freeLeft === 1 ? "" : "s"} left`} />
            <p className="min-h-5 text-sm leading-snug text-[#4A5874]">Use them first, then buy when you need more.</p>
            <a href="/dashboard" className={cn(BTN, SECONDARY)}>Go to dashboard</a>
            <List items={["Every feature included", "Full reports and recordings", "No card, no commitment"]} />
          </Col>
        ) : (
          <Col>
            <p className="text-lg font-semibold">Free trial</p>
            <Price big={trial.enabled ? "$0" : "—"} small={trial.enabled ? `${trial.interviews} interviews` : ""} />
            <p className="min-h-5 text-sm leading-snug text-[#4A5874]">{trial.enabled ? "Try it on a real role. No card needed." : "Not available right now."}</p>
            <a href={start.href} className={cn(BTN, SECONDARY)}>{start.label}</a>
            <List items={[`${trial.enabled ? trial.interviews : 0} real AI interviews`, "Every feature included", "No card, no commitment"]} />
          </Col>
        ))}

        {/* Pay per interview: follows the slider */}
        <Col active={!contact}>
          <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            Pay per interview
            {!contact && q.savingPct > 0 && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Save {q.savingPct}%</span>}
          </p>
          {contact ? <Price big="—" small="" /> : <Price big={money(q.totalCents)} small={`for ${q.qty} interviews`} />}
          <p className="min-h-5 text-sm leading-snug text-[#4A5874]">
            {contact ? `For ${pricing.contactFrom}+ interviews, see Enterprise.` : <><b className="text-[#0F1F3A] tabular">{money(q.unitCents)}</b> per interview · no subscription</>}
          </p>
          {contact
            ? <button type="button" onClick={() => set(pricing.recommended ?? min)} className={cn(BTN, SECONDARY)}>Choose fewer interviews</button>
            : onBuy
              ? <button type="button" disabled={q.belowMin} onClick={() => onBuy(q.qty)} className={cn(BTN, "gap-2 bg-[#0B5BD3] text-white shadow-sm hover:bg-[#0A4FB8] disabled:opacity-50")}>{packLabel.replace("{n}", String(q.qty))} · {money(q.totalCents)} <ArrowRight className="size-4" /></button>
              : <a href={href(q.qty)} className={cn(BTN, "gap-2 bg-[#0B5BD3] text-white shadow-sm hover:bg-[#0A4FB8]")}>{packLabel.replace("{n}", String(q.qty))} <ArrowRight className="size-4" /></a>}
          {!contact && q.better && (
            <button type="button" onClick={() => set(q.better!.qty)} className="mt-2.5 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-left text-[13px] text-amber-900 hover:border-amber-300">
              <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span><b className="tabular">{q.better.qty}</b> interviews cost <b className="tabular">{money(q.better.savesCents)}</b> less. <u>Switch to {q.better.qty}</u></span>
            </button>
          )}
          <List items={included} />
          {!onBuy && <a href="#features" className="mt-3 text-sm font-semibold text-[#0B5BD3] hover:underline">See everything included ↓</a>}
        </Col>

        {/* Enterprise */}
        <Col active={contact}>
          <p className="text-lg font-semibold">Enterprise</p>
          <Price big="Custom" small="" />
          <p className="min-h-5 text-sm leading-snug text-[#4A5874]">{pricing.contactFrom ? `For ${pricing.contactFrom}+ interviews at once.` : "For teams hiring at volume."}</p>
          <a href={contactHref} target="_blank" rel="noopener noreferrer"
            className={cn(BTN, contact ? "bg-[#0B5BD3] text-white hover:bg-[#0A4FB8]" : SECONDARY)}>Talk to us</a>
          <List items={["Everything in Pay per interview", "A custom price for your volume", "A call with our team to plan it"]} />
        </Col>
      </div>
      <p className="mt-3 text-center text-[13px] text-[#5B6B86]">Prices in US dollars; at checkout you can pay in your own currency. An interview is only used when the candidate starts it.</p>
    </div>
  );
}

const BTN = "mt-4 inline-flex h-10 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold transition-colors";
const SECONDARY = "border border-[#CBD7EA] bg-white hover:border-[#0B5BD3] hover:text-[#0B5BD3]";

function Col({ active, children }: { active?: boolean; children: React.ReactNode }) {
  return <div className={cn("relative flex flex-col bg-white p-5 sm:p-6", active && "bg-[#F7FAFF] shadow-[inset_0_3px_0_#0B5BD3]")}>{children}</div>;
}

function Price({ big, small }: { big: string; small: string }) {
  return (
    <p className="mt-2 mb-1 flex min-h-10 items-baseline gap-2">
      <span className="text-[2.25rem] leading-none font-semibold tracking-tight tabular">{big}</span>
      {small && <span className="text-sm text-[#5B6B86] tabular">{small}</span>}
    </p>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="mt-5 space-y-2 border-t border-[#E3EAF5] pt-4 text-sm text-[#3D4D6A]">
      {items.map((x) => <li key={x} className="flex gap-2.5"><Check className="mt-0.5 size-4 shrink-0 text-[#0B5BD3]" aria-hidden />{x}</li>)}
    </ul>
  );
}
