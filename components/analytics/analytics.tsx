"use client";
// Cookie consent and Google Analytics for the public website.
// - Nothing is loaded or stored for analytics until the visitor clicks Accept.
// - Analytics runs only on public pages (home, demo, job apply pages) on the live site.
// - Leaving those pages (into the app, an interview link, sign-in) switches it off before
//   anything is sent, so private addresses and page titles never reach Google.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Cookie } from "lucide-react";
import {
  CONSENT_COOKIE, CONSENT_MAX_AGE, COOKIE_SETTINGS_EVENT, GA_COOKIE_EXPIRES, GA_HOSTS, GA_ID,
  cleanLocation, cleanReferrer, isBannerPath, isTrackableUrl, isTrackedPath, type Consent,
} from "@/lib/analytics";

type GtagWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void; [k: string]: unknown };
const DISABLE_KEY = `ga-disable-${GA_ID}`;
const gw = () => window as unknown as GtagWindow;
/** Lets a test browser run analytics away from the live site (never set in normal use). */
const TEST_FLAG = "pmh-analytics-test";

function readConsent(): Consent | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE}=(granted|denied)`));
  return (m?.[1] as Consent) ?? null;
}

function writeConsent(c: Consent) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${c}; Max-Age=${CONSENT_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
}

function analyticsAllowedHere() {
  try {
    if (localStorage.getItem(TEST_FLAG) === "1") return true;
  } catch { /* storage blocked */ }
  return GA_HOSTS.includes(location.hostname);
}

/** Remove Google Analytics cookies (_ga, _ga_*) after the visitor declines. */
function clearAnalyticsCookies() {
  const names = document.cookie.split("; ").map((c) => c.split("=")[0]).filter((n) => n === "_ga" || n.startsWith("_ga_"));
  const domains = ["", location.hostname, `.${location.hostname.replace(/^www\./, "")}`];
  for (const n of names) for (const d of domains) document.cookie = `${n}=; Max-Age=0; Path=/${d ? `; Domain=${d}` : ""}`;
}

let loaded = false;
let guarded = false;

/**
 * Before Google's script loads, switch it off for any navigation that isn't to a
 * trackable public page. Our hooks run first, so the flag is set before Google
 * sees the change (history methods and back/forward).
 */
function guardNavigation() {
  if (guarded) return;
  guarded = true;
  const w = gw();
  const sync = (url: URL) => { w[DISABLE_KEY] = !(readConsent() === "granted" && isTrackableUrl(url)); };
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method].bind(history);
    history[method] = (data: unknown, unused: string, url?: string | URL | null) => {
      if (url != null) sync(new URL(String(url), location.href));
      return original(data, unused, url);
    };
  }
  window.addEventListener("popstate", () => sync(new URL(location.href)));
}

function loadAnalytics() {
  const w = gw();
  const here = new URL(location.href);
  w[DISABLE_KEY] = !isTrackableUrl(here);
  if (loaded) return;
  loaded = true;
  guardNavigation();
  w.dataLayer = w.dataLayer || [];
  w.gtag = function gtag() { w.dataLayer!.push(arguments); }; // eslint-disable-line prefer-rest-params
  // Consent Mode: advertising stays denied; only analytics storage is granted.
  w.gtag("consent", "default", { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied" });
  w.gtag("consent", "update", { analytics_storage: "granted" });
  w.gtag("js", new Date());
  w.gtag("config", GA_ID, {
    page_location: cleanLocation(here),
    page_referrer: cleanReferrer(document.referrer, location.origin),
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    cookie_expires: GA_COOKIE_EXPIRES,
    cookie_flags: "SameSite=Lax;Secure",
  });
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s);
}

function stopAnalytics() {
  const w = gw();
  w[DISABLE_KEY] = true;
  w.gtag?.("consent", "update", { analytics_storage: "denied" });
  clearAnalyticsCookies();
}

export function Analytics() {
  const pathname = usePathname();
  const [consent, setConsent] = useState<Consent | null | undefined>(undefined);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setConsent(readConsent()));
    const show = () => setOpen(true);
    window.addEventListener(COOKIE_SETTINGS_EVENT, show);
    return () => window.removeEventListener(COOKIE_SETTINGS_EVENT, show);
  }, []);

  // Start analytics on a public page once allowed; keep it switched off everywhere else.
  useEffect(() => {
    if (consent !== "granted" || !analyticsAllowedHere()) return;
    if (isTrackedPath(pathname)) loadAnalytics();
    else if (loaded) gw()[DISABLE_KEY] = true;
  }, [consent, pathname]);

  const choose = (c: Consent) => {
    writeConsent(c);
    setConsent(c);
    setOpen(false);
    if (c === "denied") stopAnalytics();
  };

  const visible = consent !== undefined && isBannerPath(pathname) && (open || consent === null);
  if (!visible) return null;
  return (
    <section role="region" aria-label="Cookie consent" className="fixed inset-x-0 bottom-0 z-50 p-3 sm:p-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-[#DCE4F0] bg-white p-4 text-[#0F1F3A] shadow-[0_12px_40px_-12px_rgba(11,30,61,0.35)] sm:flex-row sm:items-center sm:gap-5 sm:p-5">
        <Cookie className="hidden size-6 shrink-0 text-[#0B5BD3] sm:block" aria-hidden />
        <p className="flex-1 text-sm leading-relaxed text-[#3D4D6A]">
          We&apos;d like to use analytics cookies (Google Analytics) to understand how visitors use our website. No advertising, and never on candidate or recruiter pages.{" "}
          <Link href="/cookies" className="font-medium text-[#0B5BD3] underline-offset-2 hover:underline">Cookie policy</Link>
        </p>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => choose("denied")} className="h-10 flex-1 rounded-xl border border-[#CBD7EA] bg-white px-5 text-sm font-semibold text-[#0F1F3A] hover:border-[#0B5BD3] sm:flex-none">Decline</button>
          <button type="button" onClick={() => choose("granted")} className="h-10 flex-1 rounded-xl bg-[#0B5BD3] px-5 text-sm font-semibold text-white hover:bg-[#0A4FB8] sm:flex-none">Accept</button>
        </div>
      </div>
    </section>
  );
}

/** "Cookie settings" link for footers: reopens the banner so the visitor can change their choice. */
export function CookieSettingsLink({ className }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(COOKIE_SETTINGS_EVENT))}>
      Cookie settings
    </button>
  );
}
