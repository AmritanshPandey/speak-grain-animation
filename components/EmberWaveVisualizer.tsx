"use client";

/**
 * EmberWaveVisualizer
 * ===================
 * A full-bleed "ember dune" voice surface modeled on the Siri-style reference:
 * a single luminous particle ridge flowing across the lower third of a black
 * field, deep crimson on the left sweeping through scarlet and orange into
 * gold on the right, with hot white-gold sparkle at the crests.
 *
 * Architecture is shared with SandWaveVisualizer — a few THREE.Points depth
 * layers driven entirely in shaders, with per-state uniform targets that are
 * critically damped so every mood change glides:
 *
 *   1. Haze – large, soft, dim grains far back → atmosphere.
 *   2. Main – the hero ridge (grid of grains on the XZ plane).
 *   3. Fore – smaller, sharper golden grains nearer the camera.
 *   4. Dust – sparse motes drifting freely in 3D for parallax twinkle.
 *
 * What differs from the sand version:
 *   • Hue is swept along the wave's length (vHue = normalized world X), not
 *     by brightness alone — that's what produces the red→gold gradient.
 *   • A broad Gaussian envelope lifts a dominant mound just right of center,
 *     matching the reference's main crest; edges stay low and dim.
 *   • The camera sits low and nearly side-on so the field reads as a ridge
 *     silhouette rather than a dune plane.
 *
 * No microphone — all motion is simulated via the `state` prop.
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

/* ---------------------------------------------------------------- variants */

export type WaveVariantId = "ribbon" | "dunes" | "helix" | "swarm";

export interface WaveVariant {
  id: WaveVariantId;
  label: string;
  /** Short line describing the formation, for the switcher UI. */
  hint: string;
  /** Index of the shape branch in the vertex shader (uShape). */
  shape: number;
}

/**
 * Every variation shares the same ember palette and voice-reactivity — only
 * the particle formation and motion differ. Add one here and it appears in the
 * switcher automatically. `shape` must match a branch in the vertex shader.
 */
export const WAVE_VARIANTS: WaveVariant[] = [
  { id: "ribbon", label: "Ribbon", hint: "A twisting sound ribbon", shape: 0 },
  { id: "dunes", label: "Dunes", hint: "A broad rolling sand field", shape: 1 },
  { id: "helix", label: "Helix", hint: "Two braiding sand strands", shape: 2 },
  { id: "swarm", label: "Swarm", hint: "Agitated, wind-blown sand", shape: 3 },
];

export const DEFAULT_VARIANT: WaveVariantId = "ribbon";

function variantFor(id: WaveVariantId): WaveVariant {
  return WAVE_VARIANTS.find((v) => v.id === id) ?? WAVE_VARIANTS[0];
}

/** Per-state scalar targets. Damped toward, never set directly. */
interface StatePreset {
  amplitude: number; // wave height
  speed: number; // flow speed
  brightness: number; // overall luminance
  swirl: number; // inward churn (Thinking)
  focus: number; // pull grains toward center (Listening)
  shimmer: number; // high-freq twinkle (Speaking)
  converge: number; // collapse to one clean wave (Complete)
}

const STATE_PRESETS: Record<VoiceState, StatePreset> = {
  idle: {
    amplitude: 0.9,
    speed: 0.26,
    brightness: 0.95,
    swirl: 0,
    focus: 0,
    shimmer: 0,
    converge: 0,
  },
  listening: {
    amplitude: 1.08,
    speed: 0.42,
    brightness: 1.05,
    swirl: 0,
    focus: 0.65,
    shimmer: 0.08,
    converge: 0,
  },
  thinking: {
    amplitude: 0.82,
    speed: 0.5,
    brightness: 0.9,
    swirl: 1.0,
    focus: 0.3,
    shimmer: 0,
    converge: 0,
  },
  speaking: {
    amplitude: 1.5,
    speed: 1.05,
    brightness: 1.32,
    swirl: 0,
    focus: 0.12,
    shimmer: 0.85,
    converge: 0,
  },
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
  uniform float uSpanX;     // grid width, for hue normalization
  uniform float uSpanZ;     // grid depth → ribbon width normalization
  uniform float uFit;       // grid→viewport scale: same composition on any screen
  uniform float uShape;     // 0 ribbon · 1 dunes · 2 helix · 3 swarm

  attribute float aScale;   // per-grain size variance
  attribute float aRandom;  // per-grain randomness 0..1
  attribute vec3  aSeed;    // per-grain drift seed (dust)

  varying float vBright;
  varying float vRandom;
  varying float vHue;       // 0 left (crimson) → 1 right (gold)

  void main() {
    vec3 pos = position;
    float t = uTime * uSpeed;

    // Normalized seat along the grid, xq ∈ [-0.5, 0.5]. All wave shapes are
    // functions of xq, and the grid itself is scaled to the viewport by
    // uFit — so phones see the same full composition as wide screens.
    float xq = position.x / uSpanX;

    // Hue is fixed per grain by where it sits along the wave's length; the
    // grid always spans the screen, so the full red→gold sweep shows on
    // any device.
    vHue = clamp(xq / 0.85 + 0.5, 0.0, 1.0);

    // Left edge dims into the dark, the heart of the wave glows hotter.
    float xGlow = (0.78 + 0.5 * exp(-pow((xq - 0.045) / 0.185, 2.0)))
                * (0.72 + 0.28 * smoothstep(0.0, 0.3, vHue));

    if (uIsDust < 0.5) {
      // ===================== WAVE GRAIN =============================
      // The grid's z column becomes this grain's seat across the band
      // width, normalized to [-1, 1].
      float zn = position.z / (uSpanZ * 0.5);
      float seed = aRandom * 6.2831;

      // Each formation fills these: vertical (height), depth offset (zdep),
      // a fine grain shiver (ripple), and three lighting hints (crest glow,
      // node/pinch glow, rim light). Shape, motion and density differ; the
      // ember palette and voice-reactivity (uAmplitude/uSwirl/…) are shared.
      float height = 0.0;
      float zdep = 0.0;
      float ripple = 0.0;
      float crest = 0.0;
      float nodeGlow = 0.0;
      float rim = 0.0;

      if (uShape < 0.5) {
        // -------- RIBBON: a thin, twisting sound ribbon (the default). ----
        float center = sin(xq * 8.8 + t * 0.9 + 0.5 * sin(t * 0.21)) * 1.6
                     + sin(xq * 16.0 - t * 0.6) * 0.55
                     + sin(xq * 3.6 + t * 0.35) * 0.8;
        // Signed half-width: at zero crossings the band pinches and the rows
        // cross over — the twist nodes. Thinking adds a second twist.
        float wave = sin(xq * 9.0 - t * 0.5 + 0.6 * sin(t * 0.23 + xq * 3.0))
                   + uSwirl * 0.45 * sin(xq * 15.0 + t * 0.8);
        float width = wave * 1.1 * (1.0 - uFocus * 0.35);
        center = mix(center, sin(xq * 8.8 + t * 0.9) * 1.2, uConverge);
        width *= (1.0 - uConverge * 0.6);
        ripple = sin(xq * 30.0 + zn * 2.0 + t * 1.3) * (0.07 + uSwirl * 0.10);
        height = center * 0.95 + zn * width * 0.75;
        zdep = zn * 0.8;
        crest = smoothstep(-1.6, 2.2, center);
        nodeGlow = 1.0 - smoothstep(0.0, 0.55, abs(wave));
        rim = smoothstep(0.5, 1.0, abs(zn));
      } else if (uShape < 1.5) {
        // -------- DUNES: a broad, calm rolling field with real depth. -----
        float zf = zn * 3.4;
        float center = sin(xq * 5.5 + t * 0.62) * 1.3
                     + sin(xq * 9.0 - t * 0.4 + zf * 0.45) * 0.6
                     + sin(zf * 0.8 + t * 0.5) * 0.5;
        center = mix(center, sin(xq * 5.5 + t * 0.62) * 1.2, uConverge);
        ripple = sin(xq * 22.0 + zf * 1.2 + t * 1.0) * (0.09 + uSwirl * 0.06);
        height = center;
        zdep = zf;
        crest = smoothstep(-1.9, 2.0, center);
        rim = smoothstep(0.55, 1.0, abs(zn)) * 0.5;
      } else if (uShape < 2.5) {
        // -------- HELIX: two sand strands braiding around the axis. -------
        float strand = step(0.0, zn) * 2.0 - 1.0;     // -1 / +1
        float ang = xq * 11.0 - t * 1.1 + (strand > 0.0 ? 0.0 : 3.14159);
        float rad = (0.9 + 0.25 * sin(xq * 5.0 + t * 0.4)) * (1.0 - uConverge * 0.4);
        float yy = sin(ang) * rad;
        float zz = cos(ang) * rad;
        // Scatter each grain into a soft tube so a strand has body.
        height = yy + (aRandom - 0.5) * 0.55;
        zdep = zz * 0.9 + (fract(aRandom * 7.0) - 0.5) * 0.5;
        ripple = sin(seed + t * 1.4) * 0.05;
        crest = smoothstep(-1.4, 1.8, yy);
        // The two strands flare where they cross near the axis.
        nodeGlow = (1.0 - smoothstep(0.0, 0.4, abs(yy)))
                 * (1.0 - smoothstep(0.0, 0.5, abs(zz))) * 0.9;
        rim = abs(zn) * 0.4;
      } else {
        // -------- SWARM: agitated sand caught in the wind. ----------------
        float center = sin(xq * 6.0 + t * 0.7) * 1.0
                     + sin(xq * 11.0 - t * 0.5) * 0.5;
        float turb = sin(t * 1.4 + seed) * 0.7 + sin(t * 2.3 + seed * 1.7) * 0.45;
        height = center * 0.7 + zn * 0.8 + turb * (0.7 + uSwirl * 0.4);
        zdep = zn * 1.4 + sin(t * 1.0 + seed) * 0.7;
        ripple = sin(xq * 18.0 + seed + t * 1.6) * 0.22;
        crest = smoothstep(-1.9, 2.1, center + turb * 0.5);
        rim = smoothstep(0.4, 1.0, abs(zn)) * 0.4;
      }

      pos.x = position.x * uFit;
      pos.y = height * uAmplitude + ripple + (aRandom - 0.5) * 0.14;
      pos.z = zdep + uDepth;

      vec4 mv = modelViewMatrix * vec4(pos, 1.0);

      // Shared lighting: crest glow + per-shape node/rim + a slow sweeping
      // highlight, faded by depth and near the camera.
      float band = smoothstep(0.65, 1.0, sin(xq * 6.4 + t * 0.5) * 0.5 + 0.5);
      float depthFade = 1.0 - smoothstep(26.0, 48.0, -mv.z);
      // Grains drifting too near the camera would blow up into huge bokeh
      // discs — fade them out instead.
      float nearFade = smoothstep(4.5, 9.5, -mv.z);
      float centerBoost = uFocus * smoothstep(0.25, 0.0, abs(xq)) * 0.35;
      float shimmer = uShimmer * (0.5 + 0.5 * sin(aRandom * 120.0 + uTime * 7.0)) * 0.3;

      vBright = uBrightness
              * (0.22 + crest * 0.42 + nodeGlow * 0.6 + rim * 0.22 + band * 0.15
                 + centerBoost + shimmer)
              * depthFade * nearFade * xGlow;
      vBright += uPulse * 0.9 * crest * nearFade;
      vRandom = aRandom;

      // Compensate grain size for grid stretch/compression so density —
      // and with it the additive glow — holds steady across viewports.
      float px = uSize * aScale * uPixelRatio * clamp(sqrt(uFit), 0.85, 1.25);
      gl_PointSize = min(px * (8.0 / -mv.z), px * 1.25);
      gl_Position = projectionMatrix * mv;
    } else {
      // ===================== FLOATING DUST =========================
      pos.x += sin(uTime * 0.15 + aSeed.x * 6.2831) * 0.9;
      pos.x *= uFit;
      pos.y += sin(uTime * 0.12 + aSeed.y * 6.2831) * 0.7;
      pos.z += sin(uTime * 0.10 + aSeed.z * 6.2831) * 0.9 + uDepth;

      vec4 mv = modelViewMatrix * vec4(pos, 1.0);
      float depthFade = 1.0 - smoothstep(26.0, 50.0, -mv.z);
      float nearFade = smoothstep(4.5, 9.5, -mv.z);
      vBright = uBrightness * (0.35 + 0.45 * aRandom) * depthFade * nearFade * xGlow
              + uPulse * 0.25 * nearFade;
      vRandom = aRandom;

      // Compensate grain size for grid stretch/compression so density —
      // and with it the additive glow — holds steady across viewports.
      float px = uSize * aScale * uPixelRatio * clamp(sqrt(uFit), 0.85, 1.25);
      gl_PointSize = min(px * (8.0 / -mv.z), px * 1.25);
      gl_Position = projectionMatrix * mv;
    }
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform float uSoft;      // sprite edge softness (bigger = softer)
  uniform float uBrightMul; // layer luminance multiplier
  uniform float uGoldBias;  // bias this layer's tint toward gold

  varying float vBright;
  varying float vRandom;
  varying float vHue;

  void main() {
    // Soft round grain: feather the edge by uSoft.
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float sprite = smoothstep(0.5, max(0.5 - uSoft, 0.0), d);
    if (sprite <= 0.001) discard;

    // Ember palette swept along the wave's length, left → right.
    vec3 crimson  = vec3(0.42, 0.016, 0.035);
    vec3 scarlet  = vec3(0.86, 0.10, 0.045);
    vec3 ember    = vec3(1.00, 0.355, 0.06);
    vec3 amber    = vec3(1.00, 0.575, 0.12);
    vec3 gold     = vec3(1.00, 0.78, 0.31);
    vec3 paleGold = vec3(1.00, 0.93, 0.66);

    vec3 col = mix(crimson, scarlet, smoothstep(0.10, 0.38, vHue));
    col = mix(col, ember, smoothstep(0.38, 0.62, vHue));
    col = mix(col, amber, smoothstep(0.62, 0.82, vHue));
    col = mix(col, gold,  smoothstep(0.82, 0.99, vHue));

    // Crests warm up gently — hue must survive at the bright spots so the
    // red side stays red instead of washing to white.
    float b = clamp(vBright, 0.0, 1.5);
    col = mix(col, gold, smoothstep(0.65, 1.15, b) * 0.25);
    col = mix(col, paleGold, smoothstep(1.25, 1.5, b) * 0.4);
    col = mix(col, gold, uGoldBias * 0.25);

    // Per-grain opacity variance keeps the field granular, never a sheet.
    float grain = mix(0.45, 1.0, vRandom);
    float alpha = sprite * grain * clamp(b, 0.0, 1.2) * uBrightMul * 0.8;

    // Additive, rgb pre-weighted by brightness so troughs add almost
    // nothing; exposure is capped so stacked grains saturate in hue, not
    // to flat white.
    gl_FragColor = vec4(col * min(b, 1.25), alpha);
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
  goldBias: number; // tint bias toward gold
  depth: number; // z offset
  ampFactor: number; // amplitude scaling vs. the damped global
  brightFactor: number; // brightness scaling vs. the damped global
  spanX: number; // grid width (wave) / box width (dust)
  spanZ: number;
  spanY?: number; // dust vertical extent
  /** Grid jitter in cells: ~0 keeps clean halftone dot rows, ~1 scatters. */
  jitter?: number;
}

const LAYERS: LayerConfig[] = [
  // Far, soft, dim atmosphere.
  {
    name: "haze",
    mode: "wave",
    share: 0.14,
    size: 40,
    soft: 0.45,
    brightMul: 0.4,
    goldBias: 0.0,
    depth: -6,
    ampFactor: 0.85,
    brightFactor: 0.6,
    spanX: 52,
    spanZ: 2.6,
    jitter: 0.8,
  },
  // The hero ridge.
  {
    name: "main",
    mode: "wave",
    share: 0.52,
    size: 11,
    soft: 0.22,
    brightMul: 1.0,
    goldBias: 0.1,
    depth: 0,
    ampFactor: 1.0,
    brightFactor: 1.0,
    spanX: 46,
    spanZ: 2.0,
    jitter: 0.9,
  },
  // Crisper golden grains up front.
  {
    name: "fore",
    mode: "wave",
    share: 0.24,
    size: 7,
    soft: 0.12,
    brightMul: 1.0,
    goldBias: 0.4,
    depth: 3.5,
    ampFactor: 1.05,
    brightFactor: 1.05,
    spanX: 40,
    spanZ: 2.0,
    jitter: 0.9,
  },
  // Sparse floating twinkle.
  {
    name: "dust",
    mode: "dust",
    share: 0.1,
    size: 7,
    soft: 0.32,
    brightMul: 0.85,
    goldBias: 0.5,
    depth: 2,
    ampFactor: 1.0,
    brightFactor: 1.0,
    spanX: 46,
    spanZ: 20,
    spanY: 10,
  },
];

/* --------------------------------------------------------- geometry builders */

/** A flat grid of grains on the XZ plane sized to roughly hit `count`. */
function buildWaveGeometry(
  count: number,
  spanX: number,
  spanZ: number,
  jitter: number
) {
  const aspect = spanX / spanZ;
  const rows = Math.max(2, Math.round(Math.sqrt(count / aspect)));
  const cols = Math.max(2, Math.round(count / rows));
  const total = rows * cols;

  const positions = new Float32Array(total * 3);
  const scales = new Float32Array(total);
  const randoms = new Float32Array(total);
  const seeds = new Float32Array(total * 3);

  // Jitter is per-layer: the ribbon's halftone rows want a near-clean
  // lattice, scatter layers want it fully broken.
  const cellX = spanX / (cols - 1);
  const cellZ = spanZ / (rows - 1);

  let i = 0;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      positions[i * 3 + 0] =
        (c / (cols - 1) - 0.5) * spanX + (Math.random() - 0.5) * cellX * jitter;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] =
        (r / (rows - 1) - 0.5) * spanZ + (Math.random() - 0.5) * cellZ * jitter;
      scales[i] = 0.6 + Math.random() * 1.0;
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
    scales[i] = 0.5 + Math.random() * 1.2;
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
  /** Synthesized speech envelope — makes listening/speaking pulse like voice. */
  voiceLevel: number;
}

/**
 * Conversational cadence machine. Real speech isn't periodic — it comes in
 * phrases with irregular pauses, and syllable energy inside a phrase is
 * noisy. Each state alternates "burst" and "rest" phases with randomized
 * durations; inside a burst the target level is re-rolled at syllable rate.
 * The result drives `voiceLevel` through asymmetric audio-meter smoothing.
 */
interface CadenceState {
  mode: VoiceState | null; // the state this schedule was built for
  phase: "burst" | "rest";
  phaseLeft: number; // seconds remaining in the current phase
  syllLeft: number; // seconds until the next syllable retarget
  syllLevel: number; // current syllable target level
}

function stepCadence(c: CadenceState, state: VoiceState, dt: number): number {
  if (c.mode !== state) {
    // Entering a new state: brief rest so the new rhythm fades in.
    c.mode = state;
    c.phase = "rest";
    c.phaseLeft = 0.2 + Math.random() * 0.3;
    c.syllLeft = 0;
  }
  c.phaseLeft -= dt;

  if (state === "speaking") {
    // Phrases of 1–3s separated by 0.25–1s pauses.
    if (c.phaseLeft <= 0) {
      if (c.phase === "burst") {
        c.phase = "rest";
        c.phaseLeft = 0.25 + Math.random() * 0.75;
      } else {
        c.phase = "burst";
        c.phaseLeft = 1.0 + Math.random() * 2.0;
      }
    }
    if (c.phase !== "burst") return 0;
    // Syllable energy: re-roll 4–7 times a second, biased toward strong hits
    // so spoken phrases punch rather than murmur.
    c.syllLeft -= dt;
    if (c.syllLeft <= 0) {
      c.syllLeft = 0.1 + Math.random() * 0.14;
      c.syllLevel = 0.55 + Math.random() * 0.45;
    }
    // Phrase-final fall: let the last ~0.4s of a phrase trail off.
    return c.syllLevel * Math.min(1, c.phaseLeft / 0.4);
  }

  if (state === "listening") {
    // Mostly quiet, with occasional gentle swells as if it hears speech.
    if (c.phaseLeft <= 0) {
      if (c.phase === "burst") {
        c.phase = "rest";
        c.phaseLeft = 0.6 + Math.random() * 1.6;
      } else {
        c.phase = "burst";
        c.phaseLeft = 0.8 + Math.random() * 1.6;
      }
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
    // Sparse hesitation ticks between longer gaps.
    if (c.phaseLeft <= 0) {
      if (c.phase === "burst") {
        c.phase = "rest";
        c.phaseLeft = 0.5 + Math.random() * 1.2;
      } else {
        c.phase = "burst";
        c.phaseLeft = 0.25 + Math.random() * 0.3;
        c.syllLevel = 0.2 + Math.random() * 0.25;
      }
    }
    return c.phase === "burst" ? c.syllLevel : 0.05;
  }

  return 0;
}

/**
 * ParticleField owns the simulation clock + damped state and renders one
 * <ParticleLayer> per depth layer. Parents tick before children in R3F, so
 * the shared `live` ref is up to date before any layer reads it.
 */
function ParticleField({
  state,
  particleCount,
  reducedMotion,
  liveLevel,
  shape,
}: {
  state: VoiceState;
  particleCount: number;
  reducedMotion: boolean;
  liveLevel?: React.RefObject<(() => number) | null>;
  shape: number;
}) {
  const live = useRef<LiveMotion>({
    time: 0,
    pulse: 0,
    voiceLevel: 0,
    ...STATE_PRESETS[state],
  });
  const prevState = useRef<VoiceState>(state);
  const cadence = useRef<CadenceState>({
    mode: null,
    phase: "rest",
    phaseLeft: 0,
    syllLeft: 0,
    syllLevel: 0,
  });

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

    // Integrate phase rather than scaling raw time by speed — multiplying
    // accumulated time by a changing speed would scramble the wave's phase
    // at every state change. This way speed ramps only ease the flow rate.
    // The voice level also surges the flow slightly, so syllables push the
    // wave forward instead of only inflating it.
    if (!reducedMotion) l.time += dt * l.speed * (1 + l.voiceLevel * 0.45);

    // Critically-damped easing toward each target (~1.5s glide).
    const k = 1 - Math.exp(-dt / 0.5);
    l.amplitude += (target.amplitude - l.amplitude) * k;
    l.speed += (target.speed - l.speed) * k;
    l.brightness += (target.brightness - l.brightness) * k;
    l.swirl += (target.swirl - l.swirl) * k;
    l.focus += (target.focus - l.focus) * k;
    l.shimmer += (target.shimmer - l.shimmer) * k;
    l.converge += (target.converge - l.converge) * k;

    // Voice level → asymmetric audio-meter smoothing: fast attack so bursts
    // land, slow release so they decay gracefully. The asymmetry is what
    // makes it feel alive without feeling jumpy. When a live audio source is
    // attached (real mic / spoken-word pulses) it drives the level directly;
    // otherwise the synthesized conversational cadence does.
    const ext = liveLevel?.current;
    const voice = reducedMotion
      ? 0
      : ext
        ? Math.min(1, Math.max(0, ext()))
        : stepCadence(cadence.current, state, dt);
    const tau = voice > l.voiceLevel ? 0.05 : 0.26;
    l.voiceLevel += (voice - l.voiceLevel) * (1 - Math.exp(-dt / tau));
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
          shape={shape}
        />
      ))}
    </>
  );
}

/**
 * A single depth layer. Owns its geometry + material (immutable, via useMemo)
 * and writes this layer's uniforms each frame through the points ref.
 */
function ParticleLayer({
  cfg,
  particleCount,
  live,
  reducedMotion,
  shape,
}: {
  cfg: LayerConfig;
  particleCount: number;
  live: React.RefObject<LiveMotion>;
  reducedMotion: boolean;
  shape: number;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const { gl } = useThree();

  const geometry = useMemo(() => {
    const count = Math.max(2, Math.round(particleCount * cfg.share));
    return cfg.mode === "wave"
      ? buildWaveGeometry(count, cfg.spanX, cfg.spanZ, cfg.jitter ?? 1)
      : buildDustGeometry(count, cfg.spanX, cfg.spanY ?? 10, cfg.spanZ);
  }, [cfg, particleCount]);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: cfg.ampFactor },
        uSpeed: { value: 1 },
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
        uSpanX: { value: cfg.spanX },
        uSpanZ: { value: cfg.spanZ },
        uFit: { value: 1 },
        uSoft: { value: cfg.soft },
        uBrightMul: { value: cfg.brightMul },
        uGoldBias: { value: cfg.goldBias },
        uShape: { value: shape },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    // uShape is synced per-frame so switching formations never recreates the
    // material (and its GPU buffers).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, gl]);

  // Release GPU resources when this layer's geometry/material is replaced.
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  useFrame((st) => {
    const pts = pointsRef.current;
    const l = live.current;
    if (!pts || !l) return;
    const u = (pts.material as THREE.ShaderMaterial).uniforms;
    // Fit the grid to the visible width (slight overscan so the wave exits
    // the frame) — phones get the same full composition as wide screens.
    u.uFit.value = Math.min((st.viewport.width * 1.18) / cfg.spanX, 1.5);
    u.uShape.value = shape;
    // l.time is already speed-integrated phase, so uSpeed stays at 1 —
    // writing the damped speed here too would double-apply it.
    u.uTime.value = l.time;
    // Non-linear "punch": the squared term lets loud moments spike the wave
    // dramatically (like an audio meter slamming) while quiet stays calm.
    const v = l.voiceLevel;
    const punch = v * 0.7 + v * v * 0.85;
    u.uAmplitude.value = l.amplitude * cfg.ampFactor * (1 + punch);
    u.uBrightness.value =
      l.brightness * cfg.brightFactor * (1 + v * 0.4 + v * v * 0.4);
    // Thinking's hesitation ticks ripple through the churn (swirl is 0 in
    // every other state, so this is inert elsewhere).
    u.uSwirl.value = l.swirl * (1 + l.voiceLevel * 0.6);
    u.uFocus.value = l.focus;
    u.uShimmer.value = l.shimmer;
    u.uConverge.value = l.converge;
    u.uPulse.value = reducedMotion ? 0 : l.pulse;
  });

  return <points ref={pointsRef} geometry={geometry} material={material} />;
}

/* ----------------------------------------------------------------- exported */

export interface EmberWaveVisualizerProps {
  /** Drives wave intensity, speed, brightness, focus and swirl. */
  state?: VoiceState;
  /** Total grains across all depth layers (kept in the 8–15k sweet spot). */
  particleCount?: number;
  /** Extra classes for the absolutely-positioned wrapper. */
  className?: string;
  /**
   * Optional live audio source. When `.current` is a function it's read each
   * frame for a 0–1 level (real mic RMS while listening, spoken-word pulses
   * while speaking) that drives the wave directly; when null the synthesized
   * cadence takes over. A ref so attaching/detaching never re-renders R3F.
   */
  liveLevel?: React.RefObject<(() => number) | null>;
  /** Particle formation — same ember palette, different shape and motion. */
  variant?: WaveVariantId;
}

export default function EmberWaveVisualizer({
  state = "idle",
  particleCount = 24000,
  className = "",
  liveLevel,
  variant = DEFAULT_VARIANT,
}: EmberWaveVisualizerProps) {
  // Respect reduced motion (read once on mount).
  const reducedMotion = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const shape = variantFor(variant).shape;

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
      {/* Deep red bloom left-of-center, warm gold bloom on the right. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(48% 42% at 30% 72%, rgba(140,14,8,0.38) 0%, rgba(0,0,0,0) 62%), radial-gradient(44% 38% at 64% 66%, rgba(232,128,32,0.26) 0%, rgba(0,0,0,0) 65%)",
        }}
      />

      {/* The particle field. Canvas is transparent so the glow shows through.
          Camera sits low and nearly side-on so the field reads as a ridge. */}
      <Canvas
        className="!absolute inset-0"
        camera={{ position: [0, 0.9, 28], fov: 50, near: 0.1, far: 100 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        onCreated={({ camera }) => camera.lookAt(0, 0.7, 0)}
      >
        <ParticleField
          state={state}
          particleCount={particleCount}
          reducedMotion={reducedMotion}
          liveLevel={liveLevel}
          shape={shape}
        />
      </Canvas>

      {/* Dark vignette around the edges. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(80% 80% at 50% 55%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.85) 100%)",
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
