"use client";

/**
 * VoiceHero
 * =========
 * Full-bleed assistant screen: pure black field, a single greeting line in
 * the upper half, and the ember particle ridge flowing across the lower
 * third.
 *
 * The surface runs itself — a scripted loop mimics a live conversation,
 * cycling idle → listening → thinking → speaking with natural dwell times.
 * While listening/speaking, the visualizer adds a synthesized voice cadence
 * so the wave pulses like real speech. No interaction required.
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import EmberWaveVisualizer, {
  type VoiceState,
} from "@/components/EmberWaveVisualizer";

/** One simulated conversation turn: state + how long to hold it. The
 * "complete" pulse is deliberately left out — its flash reads as a jump
 * in an ambient loop. */
const SCRIPT: { state: VoiceState; ms: number }[] = [
  { state: "idle", ms: 4000 },
  { state: "listening", ms: 4200 },
  { state: "thinking", ms: 2400 },
  { state: "speaking", ms: 5200 },
  { state: "listening", ms: 3600 },
  { state: "thinking", ms: 2200 },
  { state: "speaking", ms: 4600 },
  { state: "idle", ms: 4600 },
];

const CAPTION: Record<VoiceState, string> = {
  idle: "",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  complete: "",
};

export default function VoiceHero() {
  const [step, setStep] = useState(0);
  const { state, ms } = SCRIPT[step];

  // Walk the scripted conversation loop forever.
  useEffect(() => {
    const timer = setTimeout(
      () => setStep((s) => (s + 1) % SCRIPT.length),
      ms
    );
    return () => clearTimeout(timer);
  }, [step, ms]);

  const engaged = state !== "idle";

  return (
    <main
      aria-label={`Ambient voice assistant animation, currently ${state}`}
      className="relative h-dvh w-full select-none overflow-hidden bg-black"
    >
      {/* Ember ridge pinned to the lower portion, top edge feathered away. */}
      <div
        className="absolute inset-x-0 bottom-0 h-[62%]"
        style={{
          maskImage:
            "linear-gradient(to bottom, transparent 0%, black 24%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent 0%, black 24%)",
        }}
      >
        <EmberWaveVisualizer state={state} />
      </div>

      {/* Greeting — blur-up on load, softens while the assistant is engaged. */}
      <motion.div
        animate={{ opacity: engaged ? 0.4 : 1, y: engaged ? -8 : 0 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        className="pointer-events-none absolute inset-x-0 top-[28%] z-10 flex flex-col items-center px-6 text-center"
      >
        <motion.h1
          initial={{ opacity: 0, y: 16, filter: "blur(10px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 1.1, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="font-[family-name:var(--font-nunito)] text-4xl font-light tracking-[-0.01em] text-white sm:text-6xl"
        >
          How can I help you?
        </motion.h1>
      </motion.div>

      {/* State caption, bottom center. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-8 z-10 flex justify-center">
        <AnimatePresence mode="wait">
          {CAPTION[state] && (
            <motion.span
              key={state}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.45, ease: "easeOut" }}
              className="text-[11px] font-light uppercase tracking-[0.32em] text-white/35"
            >
              {CAPTION[state]}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
