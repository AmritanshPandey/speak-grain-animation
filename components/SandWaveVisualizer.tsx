"use client";

/**
 * SandWaveVisualizer
 * ==================
 * A luxury "digital sand" voice surface. Thousands of fine grains flow like
 * sand pushed by invisible sound waves, rendered entirely on the GPU as a few
 * THREE.Points layers (no per-particle React elements).
 *
 * DEPTH LAYERS (back → front), composited additively over a dark field:
 *   1. Haze    – large, very soft, dim brown-gold grains far back → atmosphere.
 *   2. Main    – the hero sand wave (grid of grains on the XZ plane).
 *   3. Fore     – smaller, sharper champagne grains nearer the camera.
 *   4. Dust    – sparse motes drifting freely in 3D for parallax.
 *
 * HOW THE MOTION WORKS
 *   Each wave grain starts on a flat grid. In the vertex shader its height (Y)
 *   is the sum of several traveling sine waves at different frequencies and
 *   directions; because they interfere, crests form organic, never-repeating
 *   dune ridges rather than one regular ripple. A fine per-grain jitter term
 *   gives the granular, sandy texture. The five voice states only nudge a
 *   handful of uniforms — amplitude, speed, brightness, swirl, focus, shimmer,
 *   converge — and we critically damp the live values toward those targets
 *   each frame so every transition glides over ~600–900ms.
 *
 * No microphone yet — all motion is simulated.
 */

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

export type VoiceState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "complete";

/**
 * Per-state scalar targets. These are damped toward, never set directly, so
 * the surface eases between moods.
 */
interface StatePreset {
  amplitude: number; // wave height
  speed: number; // flow speed
  brightness: number; // overall luminance
  swirl: number; // inward rotation / densify (Thinking)
  focus: number; // pull grains toward center (Listening)
  shimmer: number; // high-freq twinkle (Speaking)
  converge: number; // collapse to one clean wave (Complete)
}

const STATE_PRESETS: Record<VoiceState, StatePreset> = {
  // Slow, calm, relaxed spread.
  idle: {
    amplitude: 0.48,
    speed: 0.16,
    brightness: 0.82,
    swirl: 0,
    focus: 0.1,
    shimmer: 0.12,
    converge: 0,
  },
  // Tightens toward center, slightly brighter, more focused.
  listening: {
    amplitude: 0.62,
    speed: 0.32,
    brightness: 1.02,
    swirl: 0,
    focus: 0.55,
    shimmer: 0.18,
    converge: 0,
  },
  // Denser, churning inward swirl, slower but concentrated.
  thinking: {
    amplitude: 0.7,
    speed: 0.42,
    brightness: 0.95,
    swirl: 0.65,
    focus: 0.35,
    shimmer: 0.14,
    converge: 0,
  },
  // Taller, faster waves with an elegant shimmer.
  speaking: {
    amplitude: 1.05,
    speed: 0.78,
    brightness: 1.28,
    swirl: 0,
    focus: 0.2,
    shimmer: 0.55,
    converge: 0,
  },
  // Grains align into a clean wave; a brief golden pulse fires on entry.
  complete: {
    amplitude: 1.0,
    speed: 0.5,
    brightness: 1.1,
    swirl: 0,
    focus: 0.2,
    shimmer: 0.1,
    converge: 1.0,
  },
};

/* ------------------------------------------------------------------ shaders */

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uAmplitude;
  uniform float uSpeed;
  uniform float uBrightness;
  uniform float uSwirl;
  uniform float uFocus;
  uniform float uShimmer;
  uniform float uConverge;
  uniform float uPulse;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uDepth;     // z offset for this layer
  uniform float uIsDust;    // 1.0 → free-floating dust, else wave grid

  attribute float aScale;   // per-grain size variance
  attribute float aRandom;  // per-grain randomness 0..1
  attribute vec3  aSeed;    // per-grain drift seed (dust)

  varying float vBright;
  varying float vRandom;

  void main() {
    vec3 pos = position;
    float t = uTime * uSpeed;

    if (uIsDust < 0.5) {
      // ===================== WAVE GRAIN =============================

      // Listening: gently pull grains toward the central axis so the wave
      // visibly "focuses".
      pos.xz *= (1.0 - uFocus * 0.16);

      // Thinking: rotate around the center (angle grows toward the middle and
      // oscillates in time) and densify by drawing grains slightly inward.
      if (uSwirl > 0.001) {
        float r = length(pos.xz);
        float ang = uSwirl * (1.4 / (r + 1.0)) * sin(t * 0.4);
        float s = sin(ang);
        float c = cos(ang);
        pos.xz = mat2(c, -s, s, c) * pos.xz;
        pos.xz *= (1.0 - uSwirl * 0.10);
      }

      // Layered traveling sine waves → interfering, organic dune ridges.
      float h = 0.0;
      h += sin(pos.x * 0.34 + t * 0.95) * 0.72;
      h += sin(pos.z * 0.42 - t * 0.70) * 0.46;
      h += sin((pos.x + pos.z) * 0.18 + t * 0.42) * 0.34;
      h += sin((pos.x - pos.z) * 0.29 - t * 0.88) * 0.22;
      // Fine per-grain jitter → the sandy, granular surface.
      h += sin(pos.x * 1.65 + pos.z * 1.45 + t * 1.25 + aRandom * 6.2831) * 0.10;

      // Complete: ease toward a single clean wave (drop jitter + cross ripples)
      // for a momentary, ordered surface.
      float clean = sin(pos.x * 0.28 + t) * 1.0 + sin(pos.z * 0.30 + t * 0.5) * 0.4;
      h = mix(h, clean, uConverge);

      pos.y += h * uAmplitude;
      pos.z += uDepth;

      vec4 mv = modelViewMatrix * vec4(pos, 1.0);

      // Brightness: crests glow; a slow band sweeps a highlight across; far
      // grains fade to black; focus adds a soft center bloom; speaking adds a
      // restrained per-grain shimmer; complete fires a crest pulse.
      float crest = smoothstep(0.18, 1.02, h);
      float ridge = smoothstep(0.74, 1.0, crest);
      float band = smoothstep(0.78, 1.0, sin(pos.x * 0.18 - pos.z * 0.08 + t * 0.42) * 0.5 + 0.5);
      float depthFade = 1.0 - smoothstep(10.0, 30.0, -mv.z);
      float centerBoost = uFocus * smoothstep(7.0, 0.0, length(pos.xz)) * 0.25;
      float shimmer = uShimmer * (0.5 + 0.5 * sin(aRandom * 150.0 + uTime * 6.0)) * 0.24;

      vBright = uBrightness * (0.14 + crest * 0.42 + ridge * 0.72 + band * 0.32 + centerBoost + shimmer) * depthFade;
      vBright += uPulse * 0.9 * crest;
      vRandom = aRandom;

      gl_PointSize = uSize * aScale * uPixelRatio * (8.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    } else {
      // ===================== FLOATING DUST =========================
      // Each mote follows its own slow 3D path via per-grain seeds → sparse
      // atmospheric parallax with subtle z-axis movement.
      pos.x += sin(uTime * 0.15 + aSeed.x * 6.2831) * 0.9;
      pos.y += sin(uTime * 0.12 + aSeed.y * 6.2831) * 0.7;
      pos.z += sin(uTime * 0.10 + aSeed.z * 6.2831) * 0.9 + uDepth;

      vec4 mv = modelViewMatrix * vec4(pos, 1.0);
      float depthFade = 1.0 - smoothstep(12.0, 34.0, -mv.z);
      vBright = uBrightness * (0.35 + 0.45 * aRandom) * depthFade + uPulse * 0.25;
      vRandom = aRandom;

      gl_PointSize = uSize * aScale * uPixelRatio * (8.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform float uSoft;      // sprite edge softness (bigger = softer)
  uniform float uBrightMul; // layer luminance multiplier
  uniform float uChampagne; // bias the tint toward champagne for this layer

  varying float vBright;
  varying float vRandom;

  void main() {
    // Soft round grain (not a hard star): feather the edge by uSoft.
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float sprite = smoothstep(0.5, max(0.5 - uSoft, 0.0), d);
    if (sprite <= 0.001) discard;

    // Mastercard-inspired red → orange → yellow palette.
    vec3 mcRed    = vec3(0.92, 0.04, 0.02);
    vec3 mcOrange = vec3(1.00, 0.34, 0.02);
    vec3 mcYellow = vec3(1.00, 0.76, 0.08);
    vec3 warmGold = vec3(1.00, 0.88, 0.55);

    float b = clamp(vBright, 0.0, 1.45);
    float sideMix = smoothstep(-18.0, 18.0, gl_FragCoord.x - 0.5 * 390.0);

    vec3 col = mix(mcRed, mcOrange, sideMix);
    col = mix(col, mcYellow, smoothstep(0.45, 1.15, b));
    col = mix(col, warmGold, smoothstep(1.05, 1.45, b));
    col = mix(col, mcYellow, uChampagne * 0.18);

    // More granular opacity variation keeps the field detailed, not glowy.
    float grain = mix(0.18, 0.92, vRandom);
    float microFleck = smoothstep(0.08, 1.0, fract(vRandom * 61.0));
    float alpha = sprite * grain * microFleck * clamp(b, 0.0, 1.0) * uBrightMul * 0.62;

    // Additive, but rgb is pre-weighted by brightness so dark troughs add
    // almost nothing — glow stays restrained.
    gl_FragColor = vec4(col * b, alpha);
  }
`;

/* ------------------------------------------------------------ layer config */

interface LayerConfig {
  name: string;
  mode: "wave" | "dust";
  share: number; // fraction of total particleCount
  size: number; // base gl_PointSize
  soft: number; // sprite softness
  brightMul: number; // luminance multiplier
  champagne: number; // tint bias
  depth: number; // z offset
  ampFactor: number; // amplitude scaling vs. the damped global
  brightFactor: number; // brightness scaling vs. the damped global
  spanX: number; // grid width (wave) / box width (dust)
  spanZ: number;
  spanY?: number; // dust vertical extent
}

const LAYERS: LayerConfig[] = [
  // Soft background haze, mostly hidden in black.
  {
    name: "haze",
    mode: "wave",
    share: 0.12,
    size: 30,
    soft: 0.34,
    brightMul: 0.2,
    champagne: 0.0,
    depth: -7,
    ampFactor: 0.46,
    brightFactor: 0.48,
    spanX: 46,
    spanZ: 28,
  },
  // Dense low ribbon.
  {
    name: "main",
    mode: "wave",
    share: 0.58,
    size: 10,
    soft: 0.12,
    brightMul: 0.76,
    champagne: 0.08,
    depth: 0,
    ampFactor: 0.78,
    brightFactor: 1.0,
    spanX: 38,
    spanZ: 18,
  },
  // Thin bright crest line.
  {
    name: "fore",
    mode: "wave",
    share: 0.22,
    size: 6,
    soft: 0.07,
    brightMul: 1.15,
    champagne: 0.32,
    depth: 4,
    ampFactor: 0.86,
    brightFactor: 1.22,
    spanX: 32,
    spanZ: 12,
  },
  // Sparse floating particles above the wave.
  {
    name: "dust",
    mode: "dust",
    share: 0.08,
    size: 5,
    soft: 0.2,
    brightMul: 0.34,
    champagne: 0.2,
    depth: 1.5,
    ampFactor: 1.0,
    brightFactor: 0.8,
    spanX: 32,
    spanZ: 16,
    spanY: 8,
  },
];

/* --------------------------------------------------------- geometry builders */

/** A flat grid of grains on the XZ plane sized to roughly hit `count`. */
function buildWaveGeometry(count: number, spanX: number, spanZ: number) {
  const aspect = spanX / spanZ;
  const rows = Math.max(2, Math.round(Math.sqrt(count / aspect)));
  const cols = Math.max(2, Math.round(count / rows));
  const total = rows * cols;

  const positions = new Float32Array(total * 3);
  const scales = new Float32Array(total);
  const randoms = new Float32Array(total);
  const seeds = new Float32Array(total * 3);

  let i = 0;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      positions[i * 3 + 0] = (c / (cols - 1) - 0.5) * spanX;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = (r / (rows - 1) - 0.5) * spanZ;
      scales[i] = 0.35 + Math.random() * 0.85;
      randoms[i] = Math.random();
      seeds[i * 3 + 0] = Math.random();
      seeds[i * 3 + 1] = Math.random();
      seeds[i * 3 + 2] = Math.random();
      i++;
    }
  }
  return makeGeometry(positions, scales, randoms, seeds);
}

/** A loose 3D box of motes for the dust layer. */
function buildDustGeometry(
  count: number,
  spanX: number,
  spanY: number,
  spanZ: number
) {
  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const randoms = new Float32Array(count);
  const seeds = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = (Math.random() - 0.5) * spanX;
    positions[i * 3 + 1] = (Math.random() - 0.5) * spanY;
    positions[i * 3 + 2] = (Math.random() - 0.5) * spanZ;
    scales[i] = 0.35 + Math.random() * 0.9;
    randoms[i] = Math.random();
    seeds[i * 3 + 0] = Math.random();
    seeds[i * 3 + 1] = Math.random();
    seeds[i * 3 + 2] = Math.random();
  }
  return makeGeometry(positions, scales, randoms, seeds);
}

function makeGeometry(
  positions: Float32Array,
  scales: Float32Array,
  randoms: Float32Array,
  seeds: Float32Array
) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aScale", new THREE.BufferAttribute(scales, 1));
  geo.setAttribute("aRandom", new THREE.BufferAttribute(randoms, 1));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 3));
  return geo;
}

/* ---------------------------------------------------------------- particles */

/** Shared, per-frame motion values computed once and read by every layer. */
interface LiveMotion extends StatePreset {
  time: number;
  pulse: number;
}

/**
 * ParticleField owns the simulation clock + damped state and renders one
 * <ParticleLayer> per depth layer. It runs its useFrame first (parents tick
 * before children in R3F), so the shared `live` ref is up to date before any
 * layer reads it.
 */
function ParticleField({
  state,
  particleCount,
  reducedMotion,
}: {
  state: VoiceState;
  particleCount: number;
  reducedMotion: boolean;
}) {
  const live = useRef<LiveMotion>({
    time: 0,
    pulse: 0,
    ...STATE_PRESETS[state],
  });
  const prevState = useRef<VoiceState>(state);

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05); // clamp huge frames (tab refocus)
    const target = STATE_PRESETS[state];
    const l = live.current;

    // Fire the golden pulse the instant we enter "complete".
    if (state === "complete" && prevState.current !== "complete") {
      l.pulse = 1;
    }
    prevState.current = state;
    l.pulse *= Math.pow(0.04, dt); // smooth ~0.5s decay tail

    if (!reducedMotion) l.time += dt;

    // Critically-damped easing toward each target (tau ≈ 0.22s → ~700ms feel).
    const k = 1 - Math.exp(-dt / 0.22);
    l.amplitude += (target.amplitude - l.amplitude) * k;
    l.speed += (target.speed - l.speed) * k;
    l.brightness += (target.brightness - l.brightness) * k;
    l.swirl += (target.swirl - l.swirl) * k;
    l.focus += (target.focus - l.focus) * k;
    l.shimmer += (target.shimmer - l.shimmer) * k;
    l.converge += (target.converge - l.converge) * k;
  });

  return (
    <>
      {LAYERS.map((cfg) => (
        <ParticleLayer
          key={cfg.name}
          cfg={cfg}
          particleCount={particleCount}
          live={live}
          reducedMotion={reducedMotion}
        />
      ))}
    </>
  );
}

/**
 * A single depth layer. It owns its geometry + material (immutable, via
 * useMemo) and a ref to its <points>. Each frame it reads the shared damped
 * motion and writes this layer's uniforms through the points ref — the
 * idiomatic R3F mutation, done outside render via a ref so it stays valid.
 */
function ParticleLayer({
  cfg,
  particleCount,
  live,
  reducedMotion,
}: {
  cfg: LayerConfig;
  particleCount: number;
  live: React.RefObject<LiveMotion>;
  reducedMotion: boolean;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const { gl } = useThree();

  const geometry = useMemo(() => {
    const count = Math.max(2, Math.round(particleCount * cfg.share));
    return cfg.mode === "wave"
      ? buildWaveGeometry(count, cfg.spanX, cfg.spanZ)
      : buildDustGeometry(count, cfg.spanX, cfg.spanY ?? 10, cfg.spanZ);
  }, [cfg, particleCount]);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: cfg.ampFactor },
        uSpeed: { value: 0.22 },
        uBrightness: { value: cfg.brightFactor },
        uSwirl: { value: 0 },
        uFocus: { value: 0 },
        uShimmer: { value: 0 },
        uConverge: { value: 0 },
        uPulse: { value: 0 },
        uSize: { value: cfg.size },
        uPixelRatio: { value: Math.min(gl.getPixelRatio(), 2) },
        uDepth: { value: cfg.depth },
        uIsDust: { value: cfg.mode === "dust" ? 1 : 0 },
        uSoft: { value: cfg.soft },
        uBrightMul: { value: cfg.brightMul },
        uChampagne: { value: cfg.champagne },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
  }, [cfg, gl]);

  // Release GPU resources when this layer's geometry/material is replaced.
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame(() => {
    const pts = pointsRef.current;
    const l = live.current;
    if (!pts || !l) return;
    const u = (pts.material as THREE.ShaderMaterial).uniforms;
    u.uTime.value = l.time;
    u.uAmplitude.value = l.amplitude * cfg.ampFactor;
    u.uSpeed.value = l.speed;
    u.uBrightness.value = l.brightness * cfg.brightFactor;
    u.uSwirl.value = l.swirl;
    u.uFocus.value = l.focus;
    u.uShimmer.value = l.shimmer;
    u.uConverge.value = l.converge;
    u.uPulse.value = reducedMotion ? 0 : l.pulse;
  });

  return <points ref={pointsRef} geometry={geometry} material={material} />;
}

/* ----------------------------------------------------------------- exported */

export interface SandWaveVisualizerProps {
  /** Drives wave intensity, speed, brightness, focus and swirl. */
  state?: VoiceState;
  /** Total grains across all depth layers (kept in the 8–15k sweet spot). */
  particleCount?: number;
  /** Extra classes for the absolutely-positioned wrapper. */
  className?: string;
}

export default function SandWaveVisualizer({
  state = "idle",
  particleCount = 24000,
  className = "",
}: SandWaveVisualizerProps) {
  // Respect reduced motion (read once on mount).
  const reducedMotion = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // 3–5% film grain via an inline SVG turbulence — no extra dependency.
  const noiseUrl = useMemo(
    () =>
      `url("data:image/svg+xml;utf8,${encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>`
      )}")`,
    []
  );

  return (
    <div className={`pointer-events-none absolute inset-0 ${className}`}>
      {/* Soft amber radial glow behind the waves. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(58% 34% at 50% 66%, rgba(255,108,16,0.24) 0%, rgba(214,22,5,0.12) 38%, rgba(0,0,0,0) 68%), radial-gradient(34% 26% at 74% 64%, rgba(255,190,24,0.18) 0%, rgba(0,0,0,0) 62%)",
        }}
      />

      {/* The particle field. Canvas is transparent so the glow shows through. */}
      <Canvas
        className="!absolute inset-0"
        camera={{ position: [0, 5.4, 16], fov: 48, near: 0.1, far: 100 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        onCreated={({ camera }) => camera.lookAt(0, -1.8, -2)}
      >
        <ParticleField
          state={state}
          particleCount={particleCount}
          reducedMotion={reducedMotion}
        />
      </Canvas>

      {/* Top-left warm spotlight. */}
      <div
        className="absolute inset-0 mix-blend-screen"
        style={{
          background:
            "radial-gradient(36% 30% at 26% 32%, rgba(255,118,24,0.16) 0%, rgba(0,0,0,0) 62%)",
        }}
      />

      {/* Dark vignette around the edges. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(70% 58% at 50% 58%, rgba(0,0,0,0) 38%, rgba(0,0,0,0.78) 76%, rgba(0,0,0,0.96) 100%)",
        }}
      />

      {/* Very subtle film grain. */}
      <div
        className="absolute inset-0 opacity-[0.04] mix-blend-overlay"
        style={{ backgroundImage: noiseUrl, backgroundSize: "160px 160px" }}
      />
    </div>
  );
}
