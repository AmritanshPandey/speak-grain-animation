"use client";

/**
 * CircleView
 * ==========
 * The wave clipped into a glowing circular orb, centered, with a soft ring.
 * Reuses the same WaveStage, so every variant (Ribbon … Spectrum) works inside
 * the orb. The mic control is rendered once by VoiceHero at a fixed position.
 */

import { AnimatePresence, motion } from "framer-motion";
import WaveStage from "@/components/WaveStage";
import type { ViewProps } from "@/components/voiceTypes";

const CAPTION: Record<string, string> = {
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

export default function CircleView({
  variant,
  state,
  liveLevel,
  voice,
}: ViewProps) {
  const engaged = state !== "idle";
  const isHalo = variant === "spectrum-halo";
  const isSpectrum = variant === "spectrum";
  const isSpectrumRibbon = variant === "spectrum-ribbon";
  const subtitle =
    state === "listening"
      ? voice.transcript
      : state === "speaking"
        ? voice.reply
        : "";

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-6">
      <div className="flex -translate-y-[14%] flex-col items-center gap-6">
        {/* The orb */}
        <motion.div
          animate={{ scale: engaged ? 1.03 : 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 24 }}
          className="relative h-[clamp(240px,72vw,360px)] w-[clamp(240px,72vw,360px)]"
        >
          {/* Outer glow ring */}
          <div
            className="absolute -inset-4 rounded-full"
            style={{
              background: isHalo
                ? "radial-gradient(circle, rgba(255,184,70,0.2) 0%, rgba(255,92,0,0.16) 34%, rgba(196,12,8,0.08) 52%, rgba(0,0,0,0) 74%)"
                : "radial-gradient(circle, rgba(200,120,40,0.22) 0%, rgba(0,0,0,0) 68%)",
            }}
          />
          {/* Clipped wave */}
          <div className="absolute inset-0 overflow-hidden rounded-full border border-white/10">
            <WaveStage
              variant={variant}
              state={state}
              liveLevel={liveLevel}
              className={isSpectrumRibbon ? "origin-center" : ""}
              spectrumCenterY={
                isSpectrum || isHalo || isSpectrumRibbon ? 0.5 : undefined
              }
              spectrumScaleX={
                isHalo ? 1.14 : isSpectrumRibbon ? 0.84 : undefined
              }
              spectrumScaleY={
                isHalo ? 1.14 : isSpectrumRibbon ? 1.24 : undefined
              }
            />
            {/* Inner vignette so the wave reads as an orb */}
            <div
              className="pointer-events-none absolute inset-0 rounded-full"
              style={{
                boxShadow: isHalo
                  ? "inset 0 0 52px 16px rgba(0,0,0,0.78), inset 0 0 1px 1px rgba(255,226,170,0.12)"
                  : "inset 0 0 60px 10px rgba(0,0,0,0.65)",
              }}
            />
          </div>
        </motion.div>

        {/* Caption + transcript */}
        <div className="flex h-10 flex-col items-center gap-1 text-center">
          <AnimatePresence mode="wait">
            {CAPTION[state] && (
              <motion.span
                key={state}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.4 }}
                className="text-[11px] font-light uppercase tracking-[0.3em] text-white/40"
              >
                {CAPTION[state]}
              </motion.span>
            )}
          </AnimatePresence>
          {subtitle && (
            <span className="line-clamp-1 max-w-xs text-sm font-light text-white/60">
              {subtitle}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
