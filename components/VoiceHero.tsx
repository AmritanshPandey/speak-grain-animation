"use client";

/**
 * VoiceHero
 * =========
 * Full-bleed assistant screen: pure black field, a single greeting line in
 * the upper half, and the ember particle ridge flowing across the lower
 * third.
 *
 * Two modes, chosen automatically:
 *   • Live  — when the browser supports speech and the mic is granted, a real
 *             voice loop runs (see useBrowserVoice): your microphone drives
 *             "listening", a short "thinking" beat follows, then the browser
 *             speaks a reply with the wave pulsing per word.
 *   • Ambient — otherwise (unsupported browser, mic denied, or before the
 *             session starts) a synthesized conversation loops so the screen
 *             is never dead.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import EmberWaveVisualizer, {
  DEFAULT_VARIANT,
  type VoiceState,
  type WaveVariantId,
} from "@/components/EmberWaveVisualizer";
import { useBrowserVoice } from "@/components/useBrowserVoice";
import WaveVariantSwitcher from "@/components/WaveVariantSwitcher";

const VARIANT_KEY = "voiceWaveFormation";

/** One simulated conversation turn, used only as the ambient fallback. */
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
  const voice = useBrowserVoice();

  // Color variation, remembered across visits.
  const [variant, setVariant] = useState<WaveVariantId>(DEFAULT_VARIANT);
  useEffect(() => {
    const saved = localStorage.getItem(VARIANT_KEY) as WaveVariantId | null;
    if (saved) setVariant(saved);
  }, []);
  const chooseVariant = useCallback((v: WaveVariantId) => {
    setVariant(v);
    localStorage.setItem(VARIANT_KEY, v);
  }, []);

  // Ambient fallback clock — only advances while the live loop is inactive.
  const [step, setStep] = useState(0);
  const ambient = SCRIPT[step];
  useEffect(() => {
    if (voice.active) return; // live loop owns the state
    const timer = setTimeout(
      () => setStep((s) => (s + 1) % SCRIPT.length),
      ambient.ms
    );
    return () => clearTimeout(timer);
  }, [step, ambient.ms, voice.active]);

  // Auto-start on load; if blocked (gesture/permission), retry on the first
  // user interaction, then stop retrying. `start`/`supported` are stable, so
  // this runs once on mount.
  const { supported, start } = voice;
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;

    const detach = () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
    const attempt = () => {
      start().then((ok) => {
        if (ok || cancelled) detach();
      });
    };
    const onGesture = () => {
      detach();
      attempt();
    };

    attempt(); // try immediately (auto-prompt on load)
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    return () => {
      cancelled = true;
      detach();
    };
  }, [supported, start]);

  // Live state when active, synthesized state otherwise.
  const state = voice.active ? voice.state : ambient.state;
  const liveLevel = voice.active ? voice.liveLevelRef : undefined;
  const engaged = state !== "idle";

  // What to show under the greeting: your words while listening, the reply
  // while speaking.
  const subtitle =
    voice.active && state === "listening"
      ? voice.transcript
      : voice.active && state === "speaking"
        ? voice.reply
        : "";

  const handleClick = useCallback(() => {
    if (voice.supported && !voice.active) voice.start();
  }, [voice.supported, voice.active, voice.start]);

  return (
    <main
      onClick={handleClick}
      aria-label={`Voice assistant, currently ${state}`}
      className="relative h-dvh w-full select-none overflow-hidden bg-black"
    >
      {/* Ember ridge pinned to the lower portion, top edge feathered away. */}
      <div
        className="absolute inset-x-0 bottom-0 h-[62%]"
        style={{
          maskImage: "linear-gradient(to bottom, transparent 0%, black 24%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent 0%, black 24%)",
        }}
      >
        <EmberWaveVisualizer
          state={state}
          liveLevel={liveLevel}
          variant={variant}
        />
      </div>

      {/* Variation switcher, top center. Stop clicks from reaching the
          tap-to-start handler on <main>. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-x-0 top-6 z-20 flex justify-center px-4"
      >
        <WaveVariantSwitcher value={variant} onChange={chooseVariant} />
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

        {/* Live transcript / reply, faint under the greeting. */}
        <div className="mt-4 h-6 max-w-md">
          <AnimatePresence mode="wait">
            {subtitle && (
              <motion.p
                key={subtitle}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 0.55, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                className="line-clamp-1 text-sm font-light tracking-wide text-white/70"
              >
                {subtitle}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
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
