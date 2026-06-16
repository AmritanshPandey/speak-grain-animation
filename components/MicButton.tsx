"use client";

/**
 * MicButton
 * =========
 * The Start/Stop listening control for one conversation turn:
 *   • idle      → "Start listening" (mic glyph), press to begin capture
 *   • listening → "Stop listening"  (stop glyph), press to end → think → speak
 *   • thinking / speaking → disabled, shows the current status
 *
 * Pure frosted-glass styling — no coloured glow. A faint white ring pulses
 * only while listening, for feedback.
 */

import { motion } from "framer-motion";
import type { VoiceState } from "@/components/EmberWaveVisualizer";

const STATUS: Record<VoiceState, string> = {
  idle: "Start listening",
  listening: "Stop listening",
  thinking: "Thinking…",
  speaking: "Speaking…",
  complete: "",
};

export default function MicButton({
  state,
  onStart,
  onStop,
  size = 64,
}: {
  state: VoiceState;
  onStart: () => void;
  onStop: () => void;
  /** Diameter in px. */
  size?: number;
}) {
  const listening = state === "listening";
  const busy = state === "thinking" || state === "speaking";

  return (
    <div className="flex flex-col items-center gap-5">
      <motion.button
        type="button"
        onClick={() => (listening ? onStop() : busy ? undefined : onStart())}
        disabled={busy}
        aria-label={listening ? "Stop listening" : "Start listening"}
        whileHover={busy ? undefined : { scale: 1.04 }}
        whileTap={busy ? undefined : { scale: 0.93 }}
        transition={{ type: "spring", stiffness: 420, damping: 26 }}
        className="group relative flex items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:cursor-default"
        style={{ height: size, width: size }}
      >
        {/* Faint white ring pulse — listening feedback only. */}
        {listening && (
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full border border-white/25"
            animate={{ scale: [1, 1.28], opacity: [0.5, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
          />
        )}

        {/* Frosted glass core. */}
        <span
          className="relative flex h-full w-full items-center justify-center rounded-full border border-white/15 backdrop-blur-md transition-colors duration-500 group-hover:border-white/30"
          style={{
            background:
              "radial-gradient(120% 120% at 50% 22%, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.03) 42%, rgba(0,0,0,0.32) 100%)",
            boxShadow:
              "inset 0 1px 1px rgba(255,255,255,0.22), inset 0 -10px 22px rgba(0,0,0,0.5), 0 10px 30px -8px rgba(0,0,0,0.6)",
            opacity: busy ? 0.75 : 1,
          }}
        >
          {listening ? <StopGlyph /> : busy ? <Dots /> : <MicGlyph />}
        </span>
      </motion.button>

      <span className="text-[11px] font-light uppercase tracking-[0.28em] text-white/45">
        {STATUS[state]}
      </span>
    </div>
  );
}

function MicGlyph() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="rgba(255,255,255,0.92)"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  );
}

function StopGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="rgba(255,255,255,0.92)">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function Dots() {
  return (
    <div className="flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-white/90"
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
          transition={{
            duration: 0.9,
            repeat: Infinity,
            delay: i * 0.15,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}
