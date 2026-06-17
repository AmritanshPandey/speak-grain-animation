"use client";

/**
 * FullView
 * ========
 * The original full-bleed layout: the wave fills the screen, a greeting floats
 * in the upper area, and the Start/Stop mic control sits at the bottom.
 */

import { AnimatePresence, motion } from "framer-motion";
import WaveStage from "@/components/WaveStage";
import type { ViewProps } from "@/components/voiceTypes";

export default function FullView({
  variant,
  state,
  liveLevel,
  voice,
  intensity,
}: ViewProps) {
  const engaged = state !== "idle";
  const subtitle =
    state === "listening"
      ? voice.transcript
      : state === "speaking"
        ? voice.reply
        : "";

  return (
    <div className="absolute inset-0">
      {/* The gradient fills the whole page in Full view; every wave formation
          uses the same bottom stage so switching variants keeps position. */}
      {variant === "gradient" ? (
        <WaveStage
          variant={variant}
          state={state}
          liveLevel={liveLevel}
          orbShape="fill"
          intensity={intensity}
        />
      ) : (
        <div
          className="absolute inset-x-0 bottom-0 h-[62%]"
          style={{
            maskImage: "linear-gradient(to bottom, transparent 0%, black 24%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent 0%, black 24%)",
          }}
        >
          <WaveStage
            variant={variant}
            state={state}
            liveLevel={liveLevel}
            spectrumCenterY={variant === "spectrum-halo" ? 0.58 : undefined}
            intensity={intensity}
          />
        </div>
      )}

      {/* Greeting */}
      <motion.div
        animate={{ opacity: engaged ? 0.4 : 1, y: engaged ? -8 : 0 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        className="pointer-events-none absolute inset-x-0 top-[24%] z-10 flex flex-col items-center px-6 text-center"
      >
        <motion.h1
          initial={{ opacity: 0, y: 16, filter: "blur(10px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 1.1, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="font-[family-name:var(--font-nunito)] text-4xl font-light tracking-[-0.01em] text-white sm:text-6xl"
        >
          How can I help you?
        </motion.h1>

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
    </div>
  );
}
