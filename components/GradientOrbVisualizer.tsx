"use client";

/**
 * GradientOrbVisualizer
 * =====================
 * A luminous glass-gradient voice surface inspired by a warm red-orange orb:
 * overlapping blurred blooms, broad refracted light bands, film grain and a
 * gentle inner shadow. It can render as a full frame or as a clipped orb.
 *
 * Each colour layer drifts, scales and rotates independently, while thin
 * translucent bands cross the field in state-specific directions. The surface
 * never rotates as one flat asset; it feels like layered water moving at
 * different depths.
 *
 * State language:
 *   - idle: slow liquid-glass drift.
 *   - listening: currents draw inward toward the center.
 *   - thinking: counter-rotating eddies.
 *   - speaking: faster diagonal swells with brighter glass highlights.
 * `liveLevel` gently adds brightness and wave height while active.
 */

import { useEffect, useRef } from "react";
import type { VoiceState } from "@/components/EmberWaveVisualizer";

interface Blob {
  color: string;
  /** Home position (centre) within the orb. */
  x: string;
  y: string;
  /** Diameter as a fraction of the orb. */
  size: string;
  blur: number;
  blend: "screen" | "normal";
  /** Per-layer wave motion (driven per-frame so it surges with the voice). */
  ph: number; // phase offset
  fx: number; // horizontal frequency
  fy: number; // vertical frequency
  fs: number; // scale frequency
  fr: number; // rotation frequency
  ampX: number; // horizontal sway (px)
  ampY: number; // vertical chop (px)
  swell: number; // big slow swell (px)
  rot: number; // rotation amplitude (deg)
}

interface CurrentProfile {
  energy: number;
  speed: number;
  dirX: number;
  dirY: number;
  crossX: number;
  crossY: number;
  swirl: number;
  chop: number;
  focus: number;
  brightness: number;
  foam: number;
  core: number;
}

interface WaveBand {
  top: string;
  width: string;
  height: string;
  phase: number;
  angle: number;
  blur: number;
  opacity: number;
  color: string;
}

const STATE_PROFILES: Record<VoiceState, CurrentProfile> = {
  idle: {
    energy: 0.12,
    speed: 0.34,
    dirX: 0.8,
    dirY: -0.12,
    crossX: -0.18,
    crossY: 0.42,
    swirl: 0.16,
    chop: 0.18,
    focus: 0,
    brightness: 0.72,
    foam: 0.08,
    core: 0.12,
  },
  listening: {
    energy: 0.58,
    speed: 0.78,
    dirX: -0.34,
    dirY: -0.78,
    crossX: 0.72,
    crossY: 0.2,
    swirl: 0.34,
    chop: 0.34,
    focus: 0.78,
    brightness: 0.9,
    foam: 0.35,
    core: 0.52,
  },
  thinking: {
    energy: 0.52,
    speed: 0.92,
    dirX: 0.28,
    dirY: 0.24,
    crossX: -0.64,
    crossY: 0.48,
    swirl: 1.18,
    chop: 0.26,
    focus: 0.28,
    brightness: 0.82,
    foam: 0.24,
    core: 0.36,
  },
  speaking: {
    energy: 0.98,
    speed: 1.38,
    dirX: 0.92,
    dirY: -0.44,
    crossX: -0.36,
    crossY: 0.72,
    swirl: 0.48,
    chop: 0.86,
    focus: 0.12,
    brightness: 1.16,
    foam: 0.82,
    core: 0.9,
  },
  complete: {
    energy: 0.64,
    speed: 0.62,
    dirX: 0.1,
    dirY: -0.7,
    crossX: 0.28,
    crossY: 0.24,
    swirl: 0.2,
    chop: 0.14,
    focus: 0.5,
    brightness: 1.02,
    foam: 0.48,
    core: 0.7,
  },
};

// Warm reference palette: saturated red/orange body, yellow top-right glow,
// and soft milky highlight bands inside one glassy orb.
const BLOBS: Blob[] = [
  { color: "#ffdf6d", x: "62%", y: "16%", size: "94%", blur: 58, blend: "screen", ph: 0.0, fx: 0.28, fy: 0.24, fs: 0.2, fr: 0.16, ampX: 42, ampY: 48, swell: 96, rot: 10 },
  { color: "#ff7a00", x: "58%", y: "42%", size: "116%", blur: 72, blend: "screen", ph: 1.05, fx: 0.36, fy: 0.3, fs: 0.24, fr: 0.2, ampX: 56, ampY: 62, swell: 118, rot: 14 },
  { color: "#e70b12", x: "38%", y: "62%", size: "122%", blur: 78, blend: "normal", ph: 2.2, fx: 0.31, fy: 0.28, fs: 0.22, fr: 0.18, ampX: 58, ampY: 70, swell: 134, rot: 16 },
  { color: "#ff3b00", x: "74%", y: "72%", size: "86%", blur: 58, blend: "screen", ph: 3.25, fx: 0.46, fy: 0.38, fs: 0.3, fr: 0.24, ampX: 48, ampY: 58, swell: 104, rot: 14 },
  { color: "#fff1b0", x: "86%", y: "26%", size: "68%", blur: 48, blend: "screen", ph: 4.4, fx: 0.5, fy: 0.42, fs: 0.34, fr: 0.28, ampX: 40, ampY: 50, swell: 90, rot: 16 },
];

const WAVE_BANDS: WaveBand[] = [
  { top: "10%", width: "126%", height: "25%", phase: 0.0, angle: -18, blur: 28, opacity: 0.28, color: "rgba(255, 248, 210, 0.62)" },
  { top: "30%", width: "136%", height: "28%", phase: 1.2, angle: 16, blur: 34, opacity: 0.18, color: "rgba(255, 198, 86, 0.42)" },
  { top: "58%", width: "138%", height: "31%", phase: 2.4, angle: -22, blur: 36, opacity: 0.23, color: "rgba(255, 244, 192, 0.55)" },
  { top: "73%", width: "124%", height: "22%", phase: 3.6, angle: 11, blur: 30, opacity: 0.18, color: "rgba(255, 130, 28, 0.36)" },
];

const NOISE_URL = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>`
)}")`;

export default function GradientOrbVisualizer({
  state = "idle",
  liveLevel,
  className = "",
  shape = "circle",
}: {
  state?: VoiceState;
  liveLevel?: React.RefObject<(() => number) | null>;
  className?: string;
  /** "circle" → crisp clipped orb; "fill" → full-bleed rectangle. */
  shape?: "circle" | "fill";
}) {
  const coreRef = useRef<HTMLDivElement>(null);
  const foamRef = useRef<HTMLDivElement>(null);
  const sheenRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<VoiceState>(state);
  const blobRefs = useRef<(HTMLDivElement | null)[]>([]);
  const bandRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Per-frame ocean motion. Profiles are damped instead of snapped so state
  // changes feel like changing currents rather than hard scene cuts.
  useEffect(() => {
    let raf = 0;
    let energy = STATE_PROFILES[stateRef.current].energy;
    let speed = STATE_PROFILES[stateRef.current].speed;
    let dirX = STATE_PROFILES[stateRef.current].dirX;
    let dirY = STATE_PROFILES[stateRef.current].dirY;
    let crossX = STATE_PROFILES[stateRef.current].crossX;
    let crossY = STATE_PROFILES[stateRef.current].crossY;
    let swirl = STATE_PROFILES[stateRef.current].swirl;
    let chop = STATE_PROFILES[stateRef.current].chop;
    let focus = STATE_PROFILES[stateRef.current].focus;
    let brightness = STATE_PROFILES[stateRef.current].brightness;
    let foam = STATE_PROFILES[stateRef.current].foam;
    let corePower = STATE_PROFILES[stateRef.current].core;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      const target = STATE_PROFILES[stateRef.current];
      const voice = stateRef.current === "idle" ? 0 : (liveLevel?.current?.() ?? 0);
      const k = 0.045;
      energy += (Math.min(1.45, target.energy + voice * 0.7) - energy) * k;
      speed += (target.speed - speed) * k;
      dirX += (target.dirX - dirX) * k;
      dirY += (target.dirY - dirY) * k;
      crossX += (target.crossX - crossX) * k;
      crossY += (target.crossY - crossY) * k;
      swirl += (target.swirl - swirl) * k;
      chop += (target.chop + voice * 0.35 - chop) * k;
      focus += (target.focus - focus) * k;
      brightness += (target.brightness + voice * 0.18 - brightness) * k;
      foam += (Math.min(1.1, target.foam + voice * 0.55) - foam) * k;
      corePower += (Math.min(1.15, target.core + voice * 0.5) - corePower) * k;

      const amp = 0.32 + energy;
      const time = t * speed;

      for (let i = 0; i < BLOBS.length; i++) {
        const el = blobRefs.current[i];
        if (!el) continue;
        const b = BLOBS[i];
        const towardCenterX = (50 - Number.parseFloat(b.x)) * 7.2 * focus;
        const towardCenterY = (50 - Number.parseFloat(b.y)) * 5.6 * focus;
        const x =
          Math.sin(time * b.fx + b.ph) * b.ampX +
          Math.sin(time * b.fx * 0.46 + b.ph * 1.7) * b.ampX * 0.48 +
          Math.sin(time * 0.22 + b.ph) * b.swell * dirX * 0.36 +
          towardCenterX;
        const y =
          Math.sin(time * b.fy + b.ph * 1.3) * b.ampY +
          Math.sin(time * 0.18 + b.ph) * b.swell * (0.62 + chop) +
          Math.sin(time * 0.27 + b.ph * 0.7) * b.swell * dirY * 0.32 +
          towardCenterY;
        const s =
          1 +
          Math.sin(time * b.fs + b.ph) * 0.065 * (1 + energy) +
          energy * 0.045;
        const r =
          Math.sin(time * b.fr + b.ph) * b.rot * (0.65 + amp * 0.4) +
          Math.sin(time * 0.16 + b.ph) * swirl * 7;
        el.style.transform = `translate(${(x * amp).toFixed(1)}px, ${(
          y * amp
        ).toFixed(1)}px) scale(${s.toFixed(3)}) rotate(${r.toFixed(2)}deg)`;
        el.style.opacity = Math.min(1, 0.72 + brightness * 0.34).toFixed(3);
      }

      for (let i = 0; i < WAVE_BANDS.length; i++) {
        const el = bandRefs.current[i];
        if (!el) continue;
        const b = WAVE_BANDS[i];
        const flow = ((time * 46 + b.phase * 70) % 260) - 130;
        const cross = Math.sin(time * 0.7 + b.phase) * 34 * (0.5 + chop);
        const x = flow * dirX + cross * crossX;
        const y = flow * dirY + cross * crossY;
        const rot = b.angle + Math.sin(time * 0.45 + b.phase) * (5 + swirl * 6);
        const scaleY = 0.9 + energy * 0.22 + Math.sin(time + b.phase) * chop * 0.08;
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(
          1
        )}px, 0) rotate(${rot.toFixed(2)}deg) scaleY(${scaleY.toFixed(3)})`;
        el.style.opacity = Math.min(0.68, b.opacity + foam * 0.38).toFixed(3);
      }

      const core = coreRef.current;
      if (core) {
        core.style.opacity = (0.08 + corePower * 0.6).toFixed(3);
        core.style.transform = `translate(-50%,-50%) scale(${(
          1 + corePower * 0.24
        ).toFixed(3)})`;
      }

      if (foamRef.current) {
        foamRef.current.style.opacity = (0.04 + foam * 0.32).toFixed(3);
        foamRef.current.style.transform = `translate3d(${(
          Math.sin(time * 0.36) * 18 * dirX
        ).toFixed(1)}px, ${(Math.sin(time * 0.42) * 18 * dirY).toFixed(
          1
        )}px, 0)`;
      }

      if (sheenRef.current) {
        sheenRef.current.style.opacity = (0.16 + brightness * 0.2).toFixed(3);
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [liveLevel]);

  const content = (
    <>
      {/* Base glass field. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(112% 96% at 64% 14%, #fff4b6 0%, rgba(255,244,182,0) 45%), radial-gradient(92% 86% at 38% 64%, #e30012 0%, rgba(227,0,18,0) 60%), radial-gradient(78% 74% at 82% 70%, rgba(255,92,0,0.92) 0%, rgba(255,92,0,0) 58%), linear-gradient(145deg, #fff0a8 0%, #ffb12d 27%, #ff5a00 52%, #e30012 100%)",
          }}
        />

        {/* Drifting colour blooms. */}
        {BLOBS.map((b, i) => (
          <div
            key={i}
            className="absolute"
            style={{
              left: b.x,
              top: b.y,
              width: b.size,
              height: b.size,
              transform: "translate(-50%,-50%)",
            }}
          >
            <div
              ref={(el) => {
                blobRefs.current[i] = el;
              }}
              className="h-full w-full rounded-full will-change-transform"
              style={
                {
                  background: `radial-gradient(circle at 50% 50%, ${b.color} 0%, ${b.color}00 70%)`,
                  filter: `blur(${b.blur}px)`,
                  mixBlendMode: b.blend,
                } as React.CSSProperties
              }
            />
          </div>
        ))}

        {/* Directional translucent wave bands. */}
        {WAVE_BANDS.map((band, i) => (
          <div
            key={i}
            ref={(el) => {
              bandRefs.current[i] = el;
            }}
            className="absolute left-[-12%] rounded-full will-change-transform"
            style={{
              top: band.top,
              width: band.width,
              height: band.height,
              background: `linear-gradient(90deg, transparent 0%, ${band.color} 24%, rgba(255,255,255,0.2) 48%, ${band.color} 70%, transparent 100%)`,
              filter: `blur(${band.blur}px)`,
              mixBlendMode: "screen",
              opacity: band.opacity,
              transform: `rotate(${band.angle}deg)`,
            }}
          />
        ))}

        {/* Warm red body weight and lower-left saturation. */}
        <div
          className="absolute inset-0 transition-opacity duration-700"
          style={{
            opacity: state === "idle" ? 0.46 : 0.36,
            background:
              "radial-gradient(64% 62% at 36% 64%, rgba(178,0,16,0.74) 0%, rgba(178,0,16,0.46) 36%, rgba(178,0,16,0) 72%), radial-gradient(44% 40% at 20% 78%, rgba(160,0,18,0.52) 0%, rgba(160,0,18,0) 68%)",
            mixBlendMode: "multiply",
          }}
        />

        {/* Milky bands and warm edge highlights. */}
        <div
          ref={sheenRef}
          className="absolute inset-0 transition-opacity duration-700"
          style={{
            opacity: 0.28,
            background:
              "radial-gradient(38% 30% at 20% 18%, rgba(255,255,232,0.9) 0%, rgba(255,225,156,0.44) 36%, rgba(255,225,156,0) 74%), radial-gradient(36% 28% at 17% 80%, rgba(255,248,224,0.86) 0%, rgba(255,207,98,0.42) 38%, rgba(255,207,98,0) 76%), radial-gradient(34% 32% at 88% 40%, rgba(255,248,210,0.82) 0%, rgba(255,225,120,0.38) 34%, rgba(255,225,120,0) 74%)",
            mixBlendMode: "screen",
          }}
        />

        {/* Fine bright glass texture, state-reactive. */}
        <div
          ref={foamRef}
          className="absolute inset-0 will-change-transform"
          style={{
            background:
              "radial-gradient(1px 1px at 18% 22%, rgba(255,255,238,0.86) 0%, transparent 100%), radial-gradient(1px 1px at 40% 34%, rgba(255,225,128,0.66) 0%, transparent 100%), radial-gradient(1px 1px at 64% 18%, rgba(255,255,255,0.7) 0%, transparent 100%), radial-gradient(1px 1px at 78% 56%, rgba(255,198,86,0.72) 0%, transparent 100%), radial-gradient(1px 1px at 28% 70%, rgba(255,239,188,0.72) 0%, transparent 100%), radial-gradient(1px 1px at 56% 82%, rgba(255,255,255,0.62) 0%, transparent 100%)",
            backgroundSize: "180px 160px",
            mixBlendMode: "screen",
            opacity: 0.08,
          }}
        />

        {/* Voice-reactive core glow (opacity/scale set per frame). */}
        <div
          ref={coreRef}
          className="absolute left-1/2 top-1/2 h-1/2 w-1/2 rounded-full"
          style={{
            transform: "translate(-50%,-50%)",
            background:
              "radial-gradient(circle, rgba(255,239,174,0.78) 0%, rgba(255,111,0,0.32) 34%, rgba(197,0,20,0) 70%)",
            filter: "blur(42px)",
            mixBlendMode: "screen",
            opacity: 0.12,
          }}
        />

        {shape === "circle" ? (
          <>
            {/* Glass rim and inner shadow make the clipped circle read as a sphere. */}
            <div
              className="absolute inset-0 rounded-full"
              style={{
                boxShadow:
                  "inset 0 0 2px rgba(255,255,255,0.42), inset 20px 24px 58px rgba(255,255,220,0.28), inset -34px -38px 82px rgba(142,0,18,0.42)",
              }}
            />
            <div
              className="absolute inset-0 rounded-full mix-blend-screen"
              style={{
                background:
                  "radial-gradient(56% 46% at 30% 17%, rgba(255,255,240,0.5) 0%, rgba(255,255,240,0) 64%), radial-gradient(42% 38% at 10% 74%, rgba(255,255,232,0.4) 0%, rgba(255,255,232,0) 70%), radial-gradient(34% 44% at 91% 39%, rgba(255,248,210,0.34) 0%, rgba(255,248,210,0) 72%)",
              }}
            />
          </>
        ) : (
          <div
            className="absolute inset-0 mix-blend-screen"
            style={{
              background:
                "radial-gradient(46% 44% at 24% 16%, rgba(255,255,238,0.42) 0%, rgba(255,255,238,0) 64%), radial-gradient(34% 36% at 88% 40%, rgba(255,244,190,0.3) 0%, rgba(255,244,190,0) 72%)",
            }}
          />
        )}

        {/* Heavy fine-grain texture, two scales for a dense tactile film. */}
        <div
          className="absolute inset-0 opacity-[0.38] mix-blend-overlay"
          style={{ backgroundImage: NOISE_URL, backgroundSize: "150px 150px" }}
        />
        <div
          className="absolute inset-0 opacity-[0.24] mix-blend-soft-light"
          style={{ backgroundImage: NOISE_URL, backgroundSize: "84px 84px" }}
        />
    </>
  );

  // Full-bleed: the gradient fills the whole frame (no circular clip).
  if (shape === "fill") {
    return (
      <div
        className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      >
        {content}
      </div>
    );
  }

  // Circle: the largest centred square that fits → a crisp, borderless orb.
  return (
    <div
      className={`pointer-events-none absolute inset-0 grid place-items-center ${className}`}
      style={{ containerType: "size" } as React.CSSProperties}
    >
      <div
        className="relative overflow-hidden rounded-full"
        style={{
          width: "min(100cqw, 100cqh)",
          height: "min(100cqw, 100cqh)",
        }}
      >
        {content}
      </div>
    </div>
  );
}
