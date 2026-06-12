"use client";

/**
 * VoiceSurfaceDemo
 * ================
 * Composes the SandWaveVisualizer inside a luxury "black glass" card with a
 * floating voice button and state pills. All chrome motion uses Framer Motion;
 * the heavy particle work stays on the GPU inside the visualizer.
 *
 * This is a UI demo only — the button simulates a voice loop and the pills set
 * the state directly. No microphone is connected.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import SandWaveVisualizer, {
  type VoiceState,
} from "@/components/SandWaveVisualizer";

const PILLS: { id: VoiceState; label: string }[] = [
  { id: "idle", label: "Idle" },
  { id: "listening", label: "Listening" },
  { id: "thinking", label: "Thinking" },
  { id: "speaking", label: "Speaking" },
  { id: "complete", label: "Complete" },
];

const HELPER: Record<VoiceState, string> = {
  idle: "Tap to begin a conversation",
  listening: "Listening to you",
  thinking: "Gathering a response",
  speaking: "Responding",
  complete: "Done",
};

export default function VoiceSurfaceDemo() {
  const [state, setState] = useState<VoiceState>("idle");
  const completeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // After the "complete" pulse, settle back to idle (matches the brief golden
  // pulse → clean wave → return-to-rest behavior).
  useEffect(() => {
    if (state === "complete") {
      completeTimer.current = setTimeout(() => setState("idle"), 1100);
    }
    return () => {
      if (completeTimer.current) clearTimeout(completeTimer.current);
    };
  }, [state]);

  // The button walks the natural voice loop one step per press.
  const advance = useCallback(() => {
    setState((s) => {
      const flow: VoiceState[] = [
        "idle",
        "listening",
        "thinking",
        "speaking",
        "complete",
      ];
      return flow[(flow.indexOf(s) + 1) % flow.length];
    });
  }, []);

  const active = state !== "idle";

  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-[#030303] p-4 sm:p-8">
      {/* ---- Premium black-glass card ---- */}
      <motion.section
        initial={{ opacity: 0, y: 24, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-5xl overflow-hidden rounded-[32px] border border-white/[0.07]"
        style={{
          background:
            "linear-gradient(160deg, #0c0a07 0%, #080604 55%, #030303 100%)",
          boxShadow:
            "0 40px 120px -40px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,243,208,0.06), inset 0 0 120px rgba(168,106,36,0.05)",
        }}
      >
        {/* Header (top-left) */}
        <div className="pointer-events-none absolute left-6 top-6 z-20 sm:left-8 sm:top-8">
          <h1 className="text-base font-medium tracking-tight text-[#F4D8A4] sm:text-lg">
            Granular Voice Interface
          </h1>
          <p className="mt-1 max-w-xs text-[11px] font-light leading-relaxed tracking-wide text-white/35 sm:text-xs">
            A tactile particle surface for AI-led conversations
          </p>
        </div>

        {/* Animation stage */}
        <div className="relative h-[520px] w-full sm:h-[600px]">
          <SandWaveVisualizer state={state} />

          {/* Centered floating voice button */}
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-end gap-6 pb-10">
            <VoiceButton state={state} active={active} onPress={advance} />

            {/* Animated state label + helper text */}
            <div className="flex flex-col items-center gap-1.5">
              <AnimatePresence mode="wait">
                <motion.span
                  key={state}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="text-sm font-medium uppercase tracking-[0.28em] text-[#F4D8A4]/90"
                >
                  {state}
                </motion.span>
              </AnimatePresence>
              <AnimatePresence mode="wait">
                <motion.span
                  key={`${state}-helper`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5 }}
                  className="text-xs font-light tracking-wide text-white/35"
                >
                  {HELPER[state]}
                </motion.span>
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* State pills */}
        <div className="relative z-20 flex flex-wrap items-center justify-center gap-2 border-t border-white/[0.05] bg-black/30 px-4 py-5 backdrop-blur-md">
          {PILLS.map((pill) => {
            const selected = pill.id === state;
            return (
              <motion.button
                key={pill.id}
                type="button"
                onClick={() => setState(pill.id)}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: "spring", stiffness: 400, damping: 28 }}
                className="relative rounded-full px-4 py-1.5 text-[13px] font-light tracking-wide outline-none focus-visible:ring-1 focus-visible:ring-[#C89445]/60"
                style={{ color: selected ? "#F4D8A4" : "rgba(255,255,255,0.45)" }}
              >
                {/* Selected background slides between pills. */}
                {selected && (
                  <motion.span
                    layoutId="pill-active"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    className="absolute inset-0 rounded-full border border-[#C89445]/40 bg-[#C89445]/[0.12]"
                    style={{
                      boxShadow: "0 0 22px -6px rgba(200,148,69,0.55)",
                    }}
                  />
                )}
                <span className="relative">{pill.label}</span>
              </motion.button>
            );
          })}
        </div>
      </motion.section>
    </div>
  );
}

/* --------------------------------------------------------------- the button */

function VoiceButton({
  state,
  active,
  onPress,
}: {
  state: VoiceState;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onPress}
      aria-label={`Voice state ${state}. Tap to advance.`}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.93 }}
      transition={{ type: "spring", stiffness: 420, damping: 26 }}
      className="group relative flex h-24 w-24 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#C89445]/60"
    >
      {/* Soft golden glow — breathes faster when active, restrained at idle. */}
      <motion.span
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(200,148,69,0.45) 0%, rgba(200,148,69,0) 70%)",
        }}
        animate={{
          opacity: active ? [0.5, 0.85, 0.5] : [0.3, 0.45, 0.3],
          scale: active ? [1.1, 1.35, 1.1] : [1.05, 1.15, 1.05],
        }}
        transition={{
          duration: active ? (state === "speaking" ? 1.2 : 2.2) : 3.5,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* Subtle animated ring. */}
      <motion.span
        aria-hidden
        className="absolute inset-0 rounded-full border border-[#C89445]/30"
        animate={{ scale: active ? [1, 1.25] : [1, 1.12], opacity: [0.6, 0] }}
        transition={{
          duration: active ? 1.8 : 3,
          repeat: Infinity,
          ease: "easeOut",
        }}
      />

      {/* Glassy core: thin gold border, inner dark gradient. */}
      <span
        className="relative flex h-full w-full items-center justify-center rounded-full border border-[#C89445]/35 backdrop-blur-md transition-colors duration-500 group-hover:border-[#F4D8A4]/55"
        style={{
          background:
            "radial-gradient(120% 120% at 50% 25%, rgba(244,216,164,0.12) 0%, rgba(18,11,5,0.85) 55%, rgba(3,3,3,0.95) 100%)",
          boxShadow:
            "inset 0 1px 1px rgba(255,243,208,0.18), inset 0 -8px 16px rgba(0,0,0,0.6)",
        }}
      >
        <MicGlyph active={active} />
      </span>
    </motion.button>
  );
}

function MicGlyph({ active }: { active: boolean }) {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="transition-colors duration-500"
      style={{ color: active ? "#FFF3D0" : "#F4D8A4" }}
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  );
}
