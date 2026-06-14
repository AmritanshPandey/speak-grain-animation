"use client";

/**
 * WaveVariantSwitcher
 * ===================
 * A small glassy control to switch the particle wave's formation (same ember
 * colors, different sand motion). Each chip carries a tiny glyph hinting at the
 * shape, with a sliding highlight (Framer `layoutId`) marking the active one.
 * Reads its options from WAVE_VARIANTS, so adding a formation adds a chip here.
 */

import { motion } from "framer-motion";
import {
  WAVE_VARIANTS,
  type WaveVariantId,
} from "@/components/EmberWaveVisualizer";

/** A 20×12 line glyph hinting at each formation. */
function VariantGlyph({ id }: { id: WaveVariantId }) {
  const common = {
    width: 20,
    height: 12,
    viewBox: "0 0 20 12",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (id) {
    case "ribbon":
      return (
        <svg {...common} aria-hidden>
          <path d="M1 6 Q5 1 9 6 T17 6" />
        </svg>
      );
    case "dunes":
      return (
        <svg {...common} aria-hidden>
          <path d="M1 9 Q4 4 7 8 T13 7 T19 9" />
          <path d="M1 11 Q6 7 11 10 T19 11" opacity="0.5" />
        </svg>
      );
    case "helix":
      return (
        <svg {...common} aria-hidden>
          <path d="M1 6 Q5 1 9 6 T17 6" />
          <path d="M1 6 Q5 11 9 6 T17 6" opacity="0.7" />
        </svg>
      );
    case "swarm":
    default:
      return (
        <svg {...common} aria-hidden strokeWidth={0} fill="currentColor">
          {[
            [3, 5],
            [6, 8],
            [8, 3],
            [11, 6],
            [13, 9],
            [15, 4],
            [17, 7],
            [5, 10],
          ].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r={1} />
          ))}
        </svg>
      );
  }
}

export default function WaveVariantSwitcher({
  value,
  onChange,
}: {
  value: WaveVariantId;
  onChange: (v: WaveVariantId) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Wave formation"
      className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/10 bg-black/40 p-1 backdrop-blur-md"
    >
      {WAVE_VARIANTS.map((variant) => {
        const active = variant.id === value;
        return (
          <button
            key={variant.id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={variant.label}
            title={variant.hint}
            onClick={() => onChange(variant.id)}
            className="relative flex items-center gap-2 rounded-full px-3 py-1.5 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-white/40"
          >
            {active && (
              <motion.span
                layoutId="variant-active"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                className="absolute inset-0 rounded-full border border-[#C89445]/40 bg-[#C89445]/15"
              />
            )}
            <span
              className="relative transition-colors"
              style={{ color: active ? "#F4D8A4" : "rgba(255,255,255,0.45)" }}
            >
              <VariantGlyph id={variant.id} />
            </span>
            <span
              className="relative text-[11px] font-light tracking-wide transition-colors"
              style={{ color: active ? "#fff" : "rgba(255,255,255,0.5)" }}
            >
              {variant.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
