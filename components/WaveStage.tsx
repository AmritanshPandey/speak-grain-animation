"use client";

/**
 * WaveStage
 * =========
 * Renders the selected visualizer — a particle formation, a spectrum style, or
 * the gradient orb — by `variant`. Each fills its parent (absolute inset-0), so
 * any sized or clipped container frames it.
 */

import EmberWaveVisualizer, {
  type VoiceState,
  type WaveVariantId,
} from "@/components/EmberWaveVisualizer";
import SpectrumWaveVisualizer from "@/components/SpectrumWaveVisualizer";
import GradientOrbVisualizer from "@/components/GradientOrbVisualizer";

export default function WaveStage({
  variant,
  state,
  liveLevel,
  className = "",
  orbShape = "circle",
  spectrumCenterY,
  spectrumScaleX,
  spectrumScaleY,
}: {
  variant: string;
  state: VoiceState;
  liveLevel?: React.RefObject<(() => number) | null>;
  className?: string;
  /** For the gradient orb: "circle" clipped orb, or "fill" full-bleed. */
  orbShape?: "circle" | "fill";
  /** Optional vertical UV center for spectrum variants in clipped layouts. */
  spectrumCenterY?: number;
  spectrumScaleX?: number;
  spectrumScaleY?: number;
}) {
  if (
    variant === "spectrum" ||
    variant === "spectrum-ribbon" ||
    variant === "spectrum-halo"
  ) {
    return (
      <SpectrumWaveVisualizer
        state={state}
        liveLevel={liveLevel}
        className={className}
        centerY={spectrumCenterY}
        scaleX={spectrumScaleX}
        scaleY={spectrumScaleY}
        variant={
          variant === "spectrum-halo"
            ? "halo"
            : variant === "spectrum-ribbon"
              ? "ribbon"
              : "beam"
        }
      />
    );
  }
  if (variant === "gradient") {
    return (
      <GradientOrbVisualizer
        state={state}
        liveLevel={liveLevel}
        className={className}
        shape={orbShape}
      />
    );
  }
  return (
    <EmberWaveVisualizer
      state={state}
      liveLevel={liveLevel}
      variant={variant as WaveVariantId}
      className={className}
    />
  );
}
