"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/** The circle has two looks: speaking (pulses with the voice) and listening (still) for every other state. */
export type AvatarState = "idle" | "connecting" | "speaking" | "listening" | "thinking" | "finishing";

/**
 * The AI interviewer as the first letter of their name in a circle, like a video call with the camera
 * off. It works with any name and any voice, male or female. While the interviewer speaks, rings pulse
 * out and the circle moves gently with the voice.
 *
 * `level` (0–1) is the live loudness of the interviewer's voice. Without it (browser voice, intro audio)
 * the circle moves in a natural talking rhythm.
 */
export function AiAvatar({ name, state, level, size = 128, className }: {
  name: string; state: AvatarState; level?: React.RefObject<number | null>; size?: number; className?: string;
}) {
  const circle = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    let frame = 0;
    let amount = 0;
    let drawn = -1;
    let speakingSince = 0;
    let heardVoice = false;
    const tick = (t: number) => {
      let target = 0;
      if (stateRef.current === "speaking") {
        if (!speakingSince) { speakingSince = t; heardVoice = false; }
        const live = level?.current;
        if (live != null && live > 0.03) heardVoice = true;
        // Use the real voice when it can be measured. Some browsers give silence for it, so after
        // 1.5 s of "speaking" with nothing measured, fall back to a natural talking rhythm.
        const useLive = live != null && (heardVoice || t - speakingSince < 1500);
        target = useLive
          ? (live! > 0.03 ? Math.min(1, live! * 1.6) : 0)
          : Math.max(0, Math.abs(Math.sin(t / 95) * Math.sin(t / 233)) * 0.9 - 0.08);
      } else {
        speakingSince = 0;
      }
      amount += (target - amount) * (target > amount ? 0.5 : 0.25);
      if (amount < 0.005) amount = 0;
      // Only touch the page when something changed (nothing to do while listening).
      if (circle.current && Math.abs(amount - drawn) > 0.004) {
        drawn = amount;
        circle.current.style.transform = `scale(${1 + amount * 0.07})`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [level]);

  const speaking = state === "speaking";
  const initial = (name.trim().match(/\p{L}|\p{N}/u)?.[0] ?? "A").toUpperCase();
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }} role="img" aria-label={`${name}, AI interviewer`}>
      {speaking && (
        // Rings grow from behind the circle to about 1.3× its size (the ping animation doubles its size).
        <div className="absolute inset-0 scale-[0.65]" aria-hidden>
          <span className="absolute inset-0 rounded-full bg-[#D85A30]/40 motion-safe:animate-ping [animation-duration:1.6s]" />
          <span className="absolute inset-0 rounded-full bg-[#D85A30]/25 motion-safe:animate-ping [animation-delay:0.8s] [animation-duration:1.6s]" />
        </div>
      )}
      <div ref={circle} aria-hidden
        className={cn("relative flex size-full items-center justify-center rounded-full bg-[#D85A30] font-semibold text-white ring-4 transition-shadow duration-300 select-none",
          speaking ? "ring-[#F0997B]/60 shadow-[0_0_28px_rgba(216,90,48,0.45)]" : "ring-white/10")}
        style={{ fontSize: size * 0.42 }}>
        {initial}
      </div>
    </div>
  );
}
