"use client";

/**
 * WaveVariantSwitcher
 * ===================
 * A small glassy control to switch the particle wave's formation. Each chip
 * carries a tiny glyph hinting at the
 * shape, with a sliding highlight (Framer `layoutId`) marking the active one.
 * Reads its options from WAVE_VARIANTS, so adding a formation adds a chip here.
 */

import { useId } from "react";
import { motion } from "framer-motion";

export interface VizOption {
  id: string;
  label: string;
  hint: string;
}

/** A 20×12 line glyph hinting at each formation. */
function VariantGlyph({ id }: { id: string }) {
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
    case "spectrum":
      return (
        <svg {...common} aria-hidden>
          <path d="M1 6h6 Q9.5 6 10 2.5 Q10.5 9.5 13 6 h6" />
        </svg>
      );
    case "spectrum-ribbon":
      return (
        <svg {...common} aria-hidden>
          <path d="M1 6 Q5 1.5 9 6 T19 6" />
          <path d="M1 6 Q5 10.5 9 6 T19 6" opacity="0.6" />
          <path d="M1 6h18" opacity="0.35" />
        </svg>
      );
    case "spectrum-halo":
      return (
        <svg {...common} aria-hidden>
          <circle cx="10" cy="6" r="4.3" />
          <circle cx="10" cy="6" r="2.2" opacity="0.55" />
        </svg>
      );
    case "gradient":
      return (
        <svg {...common} aria-hidden>
          <circle cx="10" cy="6" r="4.5" />
          <circle cx="8.5" cy="7" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    // View-mode glyphs (the same switcher drives the view toggle).
    case "full":
      return (
        <svg {...common} aria-hidden>
          <rect x="2" y="2" width="16" height="8" rx="1.5" />
        </svg>
      );
    case "circle":
      return (
        <svg {...common} aria-hidden>
          <circle cx="10" cy="6" r="4.5" />
        </svg>
      );
    case "chat":
      return (
        <svg {...common} aria-hidden>
          <path d="M2 3.5h16v6H7l-3 2.5v-2.5H2z" />
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
  options,
  value,
  onChange,
}: {
  options: VizOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  // Unique per instance so two switchers don't share the sliding highlight.
  const groupId = useId();
  return (
    <div
      role="radiogroup"
      aria-label="Wave formation"
      className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/10 bg-black/40 p-1 backdrop-blur-md"
    >
      {options.map((variant) => {
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
                layoutId={`active-${groupId}`}
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
            {/* Label hides on small screens so both switchers fit. */}
            <span
              className="relative hidden text-[11px] font-light tracking-wide transition-colors sm:inline"
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
