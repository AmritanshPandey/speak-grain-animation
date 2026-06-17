"use client";

/**
 * SpectrumWaveVisualizer
 * ======================
 * A different render style from the sand particles: a glowing chromatic
 * "wave packet" on black — a horizontal light beam that swells into a smooth
 * lobed peak filled with fine nested rainbow filaments (blue outer rim →
 * green/yellow → red-hot center → white core), with a faint mirror reflection.
 *
 * It's drawn entirely in one full-screen fragment shader (no particles): a
 * stack of N nested line-curves, each a thinner, warmer-tinted copy of a
 * flowing waveform localized near center by a Gaussian window. Energy (voice
 * level + state amplitude) grows the swell — near-flat line at rest, tall
 * central peak while speaking — mirroring the reference clip.
 *
 * Voice-reactivity reuses the exact same driver as the particle visualizer:
 * the damped state presets + asymmetric audio-meter smoothing, fed by the
 * live mic / spoken-word level when present, else the synthesized cadence.
 */

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { type VoiceState } from "@/components/EmberWaveVisualizer";

export type SpectrumVariantId = "beam" | "ribbon" | "halo";

/* --- Self-contained voice-level driver (no shared internals) ------------- */

/** Per-state amplitude target, mirroring the particle visualizer's feel. */
const STATE_AMP: Record<VoiceState, number> = {
  idle: 0.9,
  listening: 1.08,
  thinking: 0.82,
  speaking: 1.5,
  complete: 1.0,
};

/** Conversational cadence → a synthesized 0–1 level when no live audio. */
interface CadenceState {
  mode: VoiceState | null;
  phase: "burst" | "rest";
  phaseLeft: number;
  syllLeft: number;
  syllLevel: number;
}

function stepCadence(c: CadenceState, state: VoiceState, dt: number): number {
  if (c.mode !== state) {
    c.mode = state;
    c.phase = "rest";
    c.phaseLeft = 0.2 + Math.random() * 0.3;
    c.syllLeft = 0;
  }
  c.phaseLeft -= dt;

  if (state === "speaking") {
    if (c.phaseLeft <= 0) {
      c.phase = c.phase === "burst" ? "rest" : "burst";
      c.phaseLeft =
        c.phase === "burst" ? 1.0 + Math.random() * 2.0 : 0.25 + Math.random() * 0.75;
    }
    if (c.phase !== "burst") return 0;
    c.syllLeft -= dt;
    if (c.syllLeft <= 0) {
      c.syllLeft = 0.1 + Math.random() * 0.14;
      c.syllLevel = 0.55 + Math.random() * 0.45;
    }
    return c.syllLevel * Math.min(1, c.phaseLeft / 0.4);
  }

  if (state === "listening") {
    if (c.phaseLeft <= 0) {
      c.phase = c.phase === "burst" ? "rest" : "burst";
      c.phaseLeft =
        c.phase === "burst" ? 0.8 + Math.random() * 1.6 : 0.6 + Math.random() * 1.6;
    }
    if (c.phase !== "burst") return 0.06;
    c.syllLeft -= dt;
    if (c.syllLeft <= 0) {
      c.syllLeft = 0.2 + Math.random() * 0.25;
      c.syllLevel = 0.2 + Math.random() * 0.3;
    }
    return c.syllLevel;
  }

  if (state === "thinking") {
    if (c.phaseLeft <= 0) {
      c.phase = c.phase === "burst" ? "rest" : "burst";
      if (c.phase === "burst") {
        c.phaseLeft = 0.25 + Math.random() * 0.3;
        c.syllLevel = 0.2 + Math.random() * 0.25;
      } else {
        c.phaseLeft = 0.5 + Math.random() * 1.2;
      }
    }
    return c.phase === "burst" ? c.syllLevel : 0.05;
  }

  return 0;
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // Fill the screen directly in clip space — ignore the camera.
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  varying vec2 vUv;
  uniform float uTime;
  uniform float uLevel;    // 0–1 voice energy
  uniform float uAmp;      // damped per-state amplitude
  uniform float uAspect;   // width / height
  uniform float uCenterY;  // band center, in uv (0..1)
  uniform float uStyle;    // 0 beam · 1 translucent ribbon · 2 circular halo
  uniform float uState;    // 0 idle · 1 listening · 2 thinking · 3 speaking
  uniform float uScaleX;    // artwork scale inside the full canvas
  uniform float uScaleY;

  vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }

  const int N = 15;

  void main() {
    // x is a fraction of width (−0.5..0.5) so the packet stays a localized
    // central swell on any aspect; the beam still runs edge to edge.
    float x = (vUv.x - 0.5) / uScaleX;
    float y = (vUv.y - uCenterY) / uScaleY; // vertical distance from the beam

    float t = uTime;
    float energy = uLevel;

    if (uStyle > 1.5) {
      vec2 p = vec2(x * uAspect, y);
      float r = length(p);
      float ang = atan(p.y, p.x);
      float tau = 6.2831853;

      float listening = 1.0 - smoothstep(0.12, 0.26, abs(uState - 1.0));
      float thinking = 1.0 - smoothstep(0.12, 0.26, abs(uState - 2.0));
      float speaking = 1.0 - smoothstep(0.12, 0.26, abs(uState - 3.0));
      float engaged = max(listening, max(thinking, speaking));

      vec3 deepRed = vec3(0.80, 0.015, 0.02);
      vec3 ember = vec3(1.0, 0.18, 0.02);
      vec3 orange = vec3(1.0, 0.48, 0.02);
      vec3 gold = vec3(1.0, 0.78, 0.14);
      vec3 champagne = vec3(1.0, 0.92, 0.68);
      vec3 rose = vec3(1.0, 0.34, 0.45);

      float spin = t * (0.16 + listening * 0.18 + speaking * 0.28 - thinking * 0.05);
      float a = fract((ang + 3.1415926 + spin) / tau);
      float sweepPos = fract(0.12 + t * (0.09 + listening * 0.09 + speaking * 0.13) + energy * 0.12);
      float ad = abs(a - sweepPos);
      ad = min(ad, 1.0 - ad);

      vec3 angular = mix(deepRed, ember, smoothstep(0.0, 0.18, a));
      angular = mix(angular, orange, smoothstep(0.16, 0.36, a));
      angular = mix(angular, gold, smoothstep(0.34, 0.54, a));
      angular = mix(angular, rose, smoothstep(0.52, 0.74, a));
      angular = mix(angular, deepRed, smoothstep(0.78, 1.0, a));

      float pulse = 0.5 + 0.5 * sin(t * (1.15 + speaking * 1.4) + energy * 2.2);
      float radius = 0.232 + 0.004 * pulse + listening * 0.004 - thinking * 0.006 + speaking * 0.009;
      float liquid = sin(ang * 3.0 - t * 0.42)
                   + 0.55 * sin(ang * 5.0 + t * 0.34 + energy * 1.5)
                   + 0.28 * sin(ang * 9.0 - t * 0.23);
      float wobble = liquid * (0.0038 + engaged * 0.003 + energy * 0.004 + speaking * 0.003);

      vec3 col = vec3(0.0);
      for (int k = 0; k < 6; k++) {
        float f = float(k);
        float centered = f - 2.5;
        float layerPhase = f * 0.82;
        float rr = radius + centered * 0.0085
                 + sin(ang * (2.0 + f * 0.42) + t * (0.18 + f * 0.04) + layerPhase) * (0.0025 + thinking * 0.0045);
        float d = r - rr - wobble * (0.7 + f * 0.08);
        float lineW = 0.000032 + f * 0.000018 + energy * 0.000014;
        float bodyW = 0.00042 + f * 0.00012 + engaged * 0.00022;
        float auraW = 0.0036 + f * 0.0012 + speaking * 0.0018;
        float line = exp(-(d * d) / lineW);
        float body = exp(-(d * d) / bodyW);
        float aura = exp(-(d * d) / auraW);
        vec3 layerColor = mix(angular, gold, smoothstep(0.0, 5.0, f) * 0.28);
        layerColor = mix(layerColor, champagne, line * (0.34 + 0.18 * engaged));
        col += layerColor * (line * (0.42 + engaged * 0.28) + body * (0.18 + energy * 0.12) + aura * 0.045);
      }

      float mainD = r - radius - wobble;
      float mainLine = exp(-(mainD * mainD) / 0.000034);
      float mainBody = exp(-(mainD * mainD) / 0.00022);
      float mainAura = exp(-(mainD * mainD) / 0.0032);
      float spec = exp(-(ad * ad) / (0.0015 + energy * 0.0008));
      col += angular * mainBody * (0.85 + engaged * 0.34);
      col += champagne * mainLine * (0.9 + listening * 0.34 + speaking * 0.48);
      col += mix(orange, gold, smoothstep(0.0, 1.0, a)) * mainAura * (0.18 + engaged * 0.11);
      col += champagne * spec * mainBody * (1.3 + listening * 0.9 + speaking * 0.65);
      col += gold * spec * mainAura * (0.34 + engaged * 0.18);

      float innerD = r - (radius - 0.055 - 0.006 * sin(ang * 4.0 + t * 0.27));
      float inner = exp(-(innerD * innerD) / (0.000075 + energy * 0.00003));
      col += mix(deepRed, orange, smoothstep(0.1, 0.82, a)) * inner * (0.42 + engaged * 0.22);

      for (int g = 0; g < 4; g++) {
        float f = float(g);
        float ghostRadius = radius + 0.027 + f * 0.012
                          + sin(ang * (1.8 + f) - t * (0.12 + f * 0.05)) * (0.006 + thinking * 0.007);
        float gd = r - ghostRadius;
        float arcA = fract(a + f * 0.17 + t * (0.025 + f * 0.011));
        float arc = smoothstep(0.0, 0.16, arcA) * (1.0 - smoothstep(0.48, 0.88, arcA));
        col += mix(ember, gold, f / 3.0) * exp(-(gd * gd) / (0.0012 + f * 0.0005))
             * arc * (0.1 + thinking * 0.17 + speaking * 0.08);
      }

      float beadBand = exp(-pow(r - (radius - 0.075), 2.0) / 0.000032);
      float beadCell = fract((ang + 3.1415926 - spin * 1.8) * 30.0 / tau);
      float bead = smoothstep(0.0, 0.12, beadCell) * (1.0 - smoothstep(0.18, 0.32, beadCell));
      float beadArc = smoothstep(0.05, 0.18, a) * (1.0 - smoothstep(0.54, 0.82, a));
      col += champagne * beadBand * bead * beadArc * (0.22 + listening * 0.42 + thinking * 0.25);

      float wx = p.x;
      float waveWin = smoothstep(-0.42, -0.26, wx) * (1.0 - smoothstep(0.26, 0.42, wx));
      float waveAmp = (0.036 + energy * 0.085) * (0.65 + uAmp * 0.22);
      float wave = sin(wx * 17.0 - t * 2.2) + 0.45 * sin(wx * 29.0 + t * 1.55);
      float waveY = -0.17 + wave * waveAmp * waveWin;
      float wd = y - waveY;
      float waveLine = exp(-(wd * wd) / 0.000035) * waveWin;
      float waveGlow = exp(-(wd * wd) / 0.0018) * waveWin;
      col += speaking * (champagne * waveLine * 0.92 + orange * waveLine * 0.42 + ember * waveGlow * 0.34 + gold * waveGlow * 0.13);

      float velvet = smoothstep(0.075, radius - 0.095, r);
      col *= velvet;
      col *= 0.78 + engaged * 0.18 + speaking * energy * 0.22;

      gl_FragColor = vec4(col, 1.0);
      return;
    }

    if (uStyle > 0.5) {
      vec3 mcRed = vec3(0.96, 0.04, 0.02);
      vec3 mcOrange = vec3(1.0, 0.33, 0.02);
      vec3 mcYellow = vec3(1.0, 0.78, 0.08);
      vec3 hotCore = vec3(1.0, 0.92, 0.68);

      float amp = (0.08 + energy * 0.13) * clamp(uAmp, 0.75, 1.7);
      float lineW = 0.0022 + energy * 0.0015;
      float sheetW = 0.026 + energy * 0.01;
      float longWin = smoothstep(-0.48, -0.22, x) * (1.0 - smoothstep(0.22, 0.48, x));
      vec3 col = vec3(0.0);

      for (int k = 0; k < 9; k++) {
        float f = float(k) / 8.0;
        float phase = f * 6.2831;
        float dir = mod(float(k), 2.0) * 2.0 - 1.0;
        float offset = (f - 0.5) * 0.026;
        float local = smoothstep(-0.43, -0.12 + 0.12 * sin(phase), x)
                    * (1.0 - smoothstep(0.15 + 0.1 * cos(phase), 0.46, x));

        float strand = sin((x * (8.5 + f * 4.5)) + dir * t * (0.55 + f * 0.34) + phase);
        strand += 0.38 * sin(x * (16.0 - f * 3.0) - t * (0.42 + f * 0.22) + phase * 0.7);
        float curve = (strand * amp * (0.42 + 0.5 * local) + offset) * longWin;

        float d = y - curve;
        float ribbon = exp(-(d * d) / (sheetW * sheetW)) * local;
        float brightLine = exp(-(d * d) / (lineW * lineW)) * local;

        vec3 warm = mix(mcRed, mcOrange, smoothstep(-0.34, 0.1, x + f * 0.07));
        warm = mix(warm, mcYellow, smoothstep(-0.05, 0.38, x + f * 0.05));
        warm = mix(warm, hotCore, brightLine * 0.45);

        col += warm * ribbon * (0.11 + 0.07 * sin(phase + t));
        col += warm * brightLine * (0.65 + 0.4 * energy);
      }

      float base = exp(-(y * y) / (lineW * lineW * 1.4));
      vec3 baseColor = mix(mcRed, mcYellow, smoothstep(-0.38, 0.42, x));
      col += baseColor * base * (0.22 + energy * 0.25);

      float bloom = exp(-(y * y) / 0.026) * longWin;
      col += mix(mcRed, mcYellow, smoothstep(-0.28, 0.34, x)) * bloom * 0.11;

      gl_FragColor = vec4(col, 1.0);
      return;
    }

    // Vertical reach of the disturbance (uv units) — small, so the nested
    // lines stay fine filaments rather than thick bands.
    float amp = (0.012 + energy * 0.085) * clamp(uAmp, 0.7, 1.7);

    // Localized wave packet near center; widens a touch with energy.
    float s = 0.15 + 0.07 * energy;
    float win = exp(-(x * x) / (s * s));
    // Smooth flowing waveform that drifts between a bump and an S.
    float base = sin(x * 10.0 - t * 1.0 + 0.7 * sin(t * 0.4))
               + 0.25 * sin(x * 17.0 - t * 1.6);

    float lineW = 0.0026 + 0.0012 * energy;
    vec3 col = vec3(0.0);

    for (int k = 0; k < N; k++) {
      float f = float(k) / float(N - 1);   // 0 outer → 1 inner
      float a = 1.0 - f;                    // outer curves reach highest
      // Each line is a thinner copy, feathered apart by a small extra wobble.
      float yk = amp * a * base * win
               + amp * 0.12 * a * sin(x * 14.0 - t * 0.8 + f * 3.0) * win;

      // Ember spectrum: deep red outer rim → orange → yellow toward the
      // hot core (no cool hues). Inner lines desaturate slightly so they
      // read as hotter near the baseline.
      vec3 c = hsv2rgb(vec3(mix(0.0, 0.14, f), mix(1.0, 0.82, f), 1.0));
      float inten = 0.5 + 0.7 * a;          // outer rim brightest

      float d = (y - yk) / lineW;
      float glow = exp(-d * d);
      float hd = (y - yk) / (lineW * 4.0);
      float halo = exp(-hd * hd) * 0.14;    // soft bloom around each line
      col += c * (glow + halo) * inten;

      // Faint mirror reflection below the beam.
      float dm = (y + yk) / (lineW * 2.5);
      col += c * exp(-dm * dm) * 0.09 * inten;
    }

    // Hot gold-white core running along the beam, full width.
    float cy = y / (lineW * 1.3);
    float core = exp(-cy * cy);
    col += vec3(1.0, 0.92, 0.72) * core * (0.4 + 0.6 * energy);

    // Warm flare at the packet's base.
    float wx = x / 0.12;
    float wy = (y + amp * 0.25) / 0.04;
    col += vec3(1.0, 0.36, 0.06) * exp(-wx * wx) * exp(-wy * wy) * energy * 1.2;

    gl_FragColor = vec4(col, 1.0);
  }
`;

interface LiveSpectrum {
  time: number;
  level: number;
  amp: number;
}

function haloModeForState(state: VoiceState): number {
  if (state === "listening") return 1;
  if (state === "thinking") return 2;
  if (state === "speaking") return 3;
  return 0;
}

function SpectrumPlane({
  state,
  reducedMotion,
  liveLevel,
  variant,
  centerY,
  scaleX,
  scaleY,
  intensity = 1,
}: {
  state: VoiceState;
  reducedMotion: boolean;
  liveLevel?: React.RefObject<(() => number) | null>;
  variant: SpectrumVariantId;
  centerY?: number;
  scaleX?: number;
  scaleY?: number;
  intensity?: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { size } = useThree();
  const live = useRef<LiveSpectrum>({
    time: 0,
    level: 0,
    amp: STATE_AMP[state],
  });
  const cadence = useRef<CadenceState>({
    mode: null,
    phase: "rest",
    phaseLeft: 0,
    syllLeft: 0,
    syllLevel: 0,
  });

  const geometry = useMemo(() => new THREE.PlaneGeometry(2, 2), []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uTime: { value: 0 },
          uLevel: { value: 0 },
          uAmp: { value: 1 },
          uAspect: { value: 1 },
          uCenterY: { value: centerY ?? (variant === "halo" ? 0.5 : 0.56) },
          uStyle: { value: variant === "halo" ? 2 : variant === "ribbon" ? 1 : 0 },
          uState: { value: 0 },
          uScaleX: { value: scaleX ?? 1 },
          uScaleY: { value: scaleY ?? 1 },
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    [centerY, scaleX, scaleY, variant]
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const l = live.current;
    const mesh = meshRef.current;
    if (!mesh) return;

    // Damped per-state amplitude (~1.5s glide), same feel as the particles.
    const targetAmp = STATE_AMP[state];
    l.amp += (targetAmp - l.amp) * (1 - Math.exp(-dt / 0.5));

    // Voice level: live source if attached, else synthesized cadence;
    // asymmetric audio-meter smoothing (fast attack, slow release).
    const ext = liveLevel?.current;
    const voice = reducedMotion
      ? 0
      : ext
        ? Math.min(1, Math.max(0, ext()))
        : stepCadence(cadence.current, state, dt);
    const tau = voice > l.level ? 0.05 : 0.26;
    l.level += (voice - l.level) * (1 - Math.exp(-dt / tau));

    if (!reducedMotion) l.time += dt * (0.5 + l.level * 0.6);

    const u = (mesh.material as THREE.ShaderMaterial).uniforms;
    u.uTime.value = l.time;
    u.uLevel.value = l.level * intensity;
    u.uAmp.value = l.amp;
    u.uAspect.value = size.width / size.height;
    u.uState.value = haloModeForState(state);
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
    />
  );
}

function HaloStatusGlyph({ state }: { state: VoiceState }) {
  const isThinking = state === "thinking";
  const isSpeaking = state === "speaking";
  const isListening = state === "listening";

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
    >
      <div
        className="relative rounded-full"
        style={{
          width: "clamp(52px, 16%, 86px)",
          aspectRatio: "1",
          background:
            "radial-gradient(circle, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.46) 50%, rgba(0,0,0,0) 74%)",
          filter: isListening || isSpeaking ? "drop-shadow(0 0 18px rgba(255,150,34,0.45))" : "drop-shadow(0 0 12px rgba(255,92,0,0.28))",
          opacity: state === "complete" ? 0.72 : 1,
        }}
      >
        {isThinking ? (
          <div className="absolute inset-0 flex items-center justify-center gap-[9%]">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="block h-[9%] w-[9%] animate-pulse rounded-full bg-[#ffe1a6]"
                style={{
                  animationDelay: `${i * 140}ms`,
                  boxShadow:
                    "0 0 12px rgba(255,205,110,0.92), 0 0 24px rgba(255,80,0,0.42)",
                }}
              />
            ))}
          </div>
        ) : isSpeaking ? (
          <div className="absolute inset-0 flex items-center justify-center gap-[8%]">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="block w-[8%] animate-pulse rounded-full bg-[#fff0bf]"
                style={{
                  height: `${22 + i * 10}%`,
                  animationDelay: `${i * 100}ms`,
                  boxShadow:
                    "0 0 10px rgba(255,235,180,0.92), 0 0 24px rgba(255,88,0,0.55)",
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export interface SpectrumWaveVisualizerProps {
  state?: VoiceState;
  liveLevel?: React.RefObject<(() => number) | null>;
  className?: string;
  variant?: SpectrumVariantId;
  centerY?: number;
  scaleX?: number;
  scaleY?: number;
  intensity?: number;
}

export default function SpectrumWaveVisualizer({
  state = "idle",
  liveLevel,
  className = "",
  variant = "beam",
  centerY,
  scaleX,
  scaleY,
  intensity = 1,
}: SpectrumWaveVisualizerProps) {
  const reducedMotion = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  return (
    <div className={`pointer-events-none absolute inset-0 ${className}`}>
      <Canvas
        className="!absolute inset-0"
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <SpectrumPlane
          state={state}
          reducedMotion={reducedMotion}
          liveLevel={liveLevel}
          variant={variant}
          centerY={centerY}
          scaleX={scaleX}
          scaleY={scaleY}
          intensity={intensity}
        />
      </Canvas>
      {variant === "halo" && <HaloStatusGlyph state={state} />}
    </div>
  );
}
