"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Play, X } from "lucide-react";
import { DEMO_VIDEO } from "./demo-video";

/**
 * A small round video bubble in the corner of public pages: a silent 6-second loop of a real
 * interview that grows into the full demo video (with sound) when clicked.
 *
 * Built to never get in the way:
 * - loads nothing until the page has finished loading (the loop is ~50 KB; the full video only on click)
 * - waits for the cookie banner to be answered, and hides while the page's own demo section is on screen
 *   or another video is playing
 * - once closed or watched, it stays away for a while (remembered in this browser only)
 * - no animation for visitors who turn off motion; works with the keyboard and screen readers
 * - if anything fails (video, storage), the bubble simply doesn't show
 */

const STORE_KEY = "pmh-demo-bubble";
const SHOW_DELAY_MS = 3000;
const SNOOZE_DAYS_CLOSED = 7;
const SNOOZE_DAYS_WATCHED = 30;
const BUBBLE = { src: "/demo/demo-bubble.mp4", poster: "/demo/demo-bubble.webp" };
const COOKIE_BANNER = '[aria-label="Cookie consent"]';

function snoozed() {
  try { return Number(localStorage.getItem(STORE_KEY) ?? 0) > Date.now(); } catch { return false; }
}
function snooze(days: number) {
  try { localStorage.setItem(STORE_KEY, String(Date.now() + days * 86_400_000)); } catch { /* storage blocked: it just shows again next visit */ }
}
function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
function track(event: string) {
  (window as Window & { gtag?: (...a: unknown[]) => void }).gtag?.("event", event);
}

type Phase = "hidden" | "shown" | "leaving";

export function DemoBubble({ cta }: { cta?: { href: string; label: string } | null }) {
  const [phase, setPhase] = useState<Phase>("hidden");
  /** The page's own demo section is on screen, or another video plays: step aside for now. */
  const [aside, setAside] = useState(false);
  const dismissed = useRef(false);
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const shadeRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Decide when to show: after the page has loaded, a short pause, and the cookie banner is answered.
  useEffect(() => {
    if (snoozed()) return;
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData || window.innerHeight < 420) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let observer: MutationObserver | undefined;
    let cancelled = false;
    const reveal = () => { if (!cancelled && !dismissed.current && !snoozed()) setPhase("shown"); };
    const whenBannerGone = () => {
      if (!document.querySelector(COOKIE_BANNER)) { timer = setTimeout(reveal, SHOW_DELAY_MS); return; }
      observer = new MutationObserver(() => {
        if (document.querySelector(COOKIE_BANNER)) return;
        observer?.disconnect();
        timer = setTimeout(reveal, 1500);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    };
    const start = () => setTimeout(whenBannerGone, 300);
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    return () => { cancelled = true; clearTimeout(timer); observer?.disconnect(); window.removeEventListener("load", start); };
  }, []);

  // Step aside while the page's own demo section is visible, or another video on the page is playing.
  useEffect(() => {
    if (phase === "hidden") return;
    const section = document.getElementById("demo");
    const io = section ? new IntersectionObserver(([e]) => setAside(e.isIntersecting), { threshold: 0.25 }) : null;
    if (section) io!.observe(section);
    const onPlay = (e: Event) => {
      const v = e.target as HTMLElement;
      if (v !== videoRef.current && !v.closest?.("[data-demo-bubble]")) { dismissed.current = true; setPhase("leaving"); }
    };
    document.addEventListener("play", onPlay, true);
    return () => { io?.disconnect(); document.removeEventListener("play", onPlay, true); };
  }, [phase]);

  const hide = useCallback((days: number) => {
    dismissed.current = true;
    snooze(days);
    setPhase("leaving");
  }, []);

  const openPlayer = () => {
    const dialog = dialogRef.current, panel = panelRef.current, video = videoRef.current;
    if (!dialog || !panel || !video) return;
    track("demo_bubble_open");
    snooze(SNOOZE_DAYS_WATCHED);
    dialog.showModal();
    document.documentElement.style.overflow = "hidden";
    // The full video loads only now. Start it with sound straight from the click (browsers allow sound only from a click).
    if (!video.getAttribute("src")) video.src = DEMO_VIDEO.src;
    video.play().catch(() => { /* the visitor can press play */ });
    if (reducedMotion()) return;
    // Grow out of the bubble into the player.
    const from = bubbleRef.current?.getBoundingClientRect();
    const to = panel.getBoundingClientRect();
    if (from && to.width) {
      const scale = from.width / to.width;
      const dx = from.left + from.width / 2 - (to.left + to.width / 2);
      const dy = from.top + from.height / 2 - (to.top + to.height / 2);
      panel.animate(
        [{ transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.4, borderRadius: "999px" }, { transform: "none", opacity: 1, borderRadius: "16px" }],
        { duration: 460, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      );
    }
    shadeRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-out" });
  };

  const closePlayer = useCallback(() => {
    const dialog = dialogRef.current, panel = panelRef.current;
    if (!dialog?.open) return;
    const finish = () => {
      videoRef.current?.pause();
      dialog.close();
      document.documentElement.style.overflow = "";
      dismissed.current = true;
      setPhase("leaving");
    };
    if (reducedMotion() || !panel) { finish(); return; }
    shadeRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: "ease-in", fill: "forwards" });
    panel.animate([{ transform: "none", opacity: 1 }, { transform: "translateY(16px) scale(0.96)", opacity: 0 }], { duration: 220, easing: "ease-in", fill: "forwards" })
      .finished.then(finish, finish);
  }, []);

  // Leaving the page while the player is open: give the page its scrolling back.
  useEffect(() => () => { document.documentElement.style.overflow = ""; }, []);

  const bubbleVisible = phase !== "hidden" && !aside;

  return (
    <div data-demo-bubble>
      {phase !== "hidden" && (
        <div
          className={`fixed right-4 bottom-4 z-40 flex items-center gap-3 transition-[opacity,transform] duration-300 sm:right-6 sm:bottom-6 ${bubbleVisible && phase === "shown" ? "" : "pointer-events-none translate-y-3 opacity-0"}`}
          onTransitionEnd={() => { if (phase === "leaving") setPhase("hidden"); }}
          inert={!bubbleVisible || phase !== "shown"}
        >
          <button
            type="button" onClick={openPlayer} tabIndex={-1} aria-hidden
            className="group hidden items-center gap-2 rounded-full border border-[#DCE4F0] bg-white py-2 pr-4 pl-3 text-left shadow-[0_12px_32px_-12px_rgba(11,30,61,0.35)] sm:flex motion-safe:animate-[demo-label-in_0.5s_ease-out_0.6s_both]"
          >
            <span className="flex size-7 items-center justify-center rounded-full bg-[#0B5BD3] text-white transition-transform group-hover:scale-110"><Play className="size-3.5 translate-x-px fill-current" /></span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold text-[#0F1F3A]">Watch the 2-min demo</span>
              <span className="block text-xs text-[#5A6A86]">A real AI interview</span>
            </span>
          </button>
          <div className="relative motion-safe:animate-[demo-bubble-in_0.7s_cubic-bezier(0.2,0.8,0.2,1)_both]">
            <span aria-hidden className="pointer-events-none absolute -inset-1 rounded-full border-2 border-[#0B5BD3] motion-safe:animate-[demo-ring_2.4s_ease-out_1s_infinite] motion-reduce:hidden" />
            <button
              ref={bubbleRef} type="button" onClick={openPlayer}
              aria-label="Watch the 2-minute product demo"
              className="relative block size-[76px] overflow-hidden rounded-full bg-[#0B0F19] shadow-[0_14px_36px_-10px_rgba(11,30,61,0.55)] ring-4 ring-white transition-transform duration-300 hover:scale-105 focus-visible:outline-none focus-visible:ring-[#0B5BD3] sm:size-[104px]"
            >
              <video
                src={BUBBLE.src} poster={BUBBLE.poster} autoPlay muted loop playsInline preload="auto" aria-hidden
                className="size-full object-cover"
                onError={() => setPhase("hidden")}
              />
              <span aria-hidden className="absolute inset-x-0 bottom-1.5 mx-auto flex size-7 items-center justify-center rounded-full bg-white/95 text-[#0B5BD3] shadow sm:hidden">
                <Play className="size-3.5 translate-x-px fill-current" />
              </span>
            </button>
            <button
              type="button" onClick={() => hide(SNOOZE_DAYS_CLOSED)} aria-label="Hide the demo video"
              className="absolute -top-1 -right-1 flex size-6 items-center justify-center rounded-full border border-[#DCE4F0] bg-white text-[#5A6A86] shadow-sm hover:text-[#0F1F3A] focus-visible:outline-2 focus-visible:outline-[#0B5BD3]"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* The player. A native dialog: keeps focus inside, closes with Esc, sits above everything else. */}
      <dialog
        ref={dialogRef}
        aria-label="PickMyHire.ai product demo"
        onCancel={(e) => { e.preventDefault(); closePlayer(); }}
        className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-0 backdrop:bg-transparent"
      >
        <div ref={shadeRef} className="absolute inset-0 bg-[#0B1A33]/75 backdrop-blur-sm" onClick={closePlayer} aria-hidden />
        <div className="pointer-events-none relative flex h-full items-center justify-center p-3 sm:p-6">
          <div ref={panelRef} className="pointer-events-auto w-full max-w-5xl overflow-hidden rounded-2xl bg-[#0B0F19] shadow-[0_40px_120px_-20px_rgba(0,0,0,0.6)]">
            <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
              <p className="text-sm font-semibold text-white sm:text-base">PickMyHire.ai in 2 minutes</p>
              <button type="button" onClick={closePlayer} aria-label="Close the demo video"
                className="flex size-9 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white">
                <X className="size-5" />
              </button>
            </div>
            <video
              ref={videoRef} controls playsInline preload="none" poster={DEMO_VIDEO.poster}
              className="aspect-video w-full bg-black"
              onEnded={() => track("demo_bubble_completed")}
            />
            <div className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <Link href="/demo#walkthrough" onClick={closePlayer} className="font-medium text-[#8FB8FF] hover:text-white">Watch the full 13-minute walkthrough</Link>
              {cta && (
                <Link href={cta.href} onClick={closePlayer} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0B5BD3] px-4 py-2 font-semibold text-white hover:bg-[#0A4FB8]">
                  {cta.label} <ArrowRight className="size-4" />
                </Link>
              )}
            </div>
          </div>
        </div>
      </dialog>
    </div>
  );
}
