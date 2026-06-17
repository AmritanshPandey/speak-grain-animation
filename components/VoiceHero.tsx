"use client";

/**
 * VoiceHero
 * =========
 * Host for the browser voice assistant. Owns the voice loop (useBrowserVoice),
 * the chosen visualization (a sand formation or the spectrum), the conversation
 * history, and the view mode — Full page, Circle orb, or Chat — rendered by the
 * matching view component. Two top switchers toggle the view and the variant.
 *
 * Conversation is one turn at a time: press Start listening, talk, press Stop;
 * it thinks, speaks the reply, and returns to idle.
 */

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_VARIANT,
  WAVE_VARIANTS,
} from "@/components/EmberWaveVisualizer";
import { useBrowserVoice } from "@/components/useBrowserVoice";
import WaveVariantSwitcher, {
  type VizOption,
} from "@/components/WaveVariantSwitcher";
import MicButton from "@/components/MicButton";
import FullView from "@/components/views/FullView";
import CircleView from "@/components/views/CircleView";
import ChatView from "@/components/views/ChatView";
import type { Message } from "@/components/voiceTypes";

const VARIANT_KEY = "voiceWaveFormation";
const VIEW_KEY = "voiceViewMode";
const INTENSITY_KEY = "voiceIntensity";

/** The four particle formations, three spectrum styles, and the gradient orb. */
const VIZ_OPTIONS: VizOption[] = [
  ...WAVE_VARIANTS.map((v) => ({ id: v.id, label: v.label, hint: v.hint })),
  { id: "spectrum", label: "Spectrum", hint: "A glowing ember light wave" },
  {
    id: "spectrum-ribbon",
    label: "Trace",
    hint: "Mastercard red and yellow spectrum ribbons",
  },
  {
    id: "spectrum-halo",
    label: "Halo",
    hint: "A warm neon halo with clean state motion",
  },
  { id: "gradient", label: "Gradient", hint: "Warm glass gradient orb" },
];
const VIZ_IDS = new Set(VIZ_OPTIONS.map((o) => o.id));

// Chat view is hidden for now (ChatView is kept for easy re-enable).
const VIEW_OPTIONS: VizOption[] = [
  { id: "full", label: "Full", hint: "Full-screen wave" },
  { id: "circle", label: "Circle", hint: "Glowing orb" },
];
const VIEW_IDS = new Set(VIEW_OPTIONS.map((o) => o.id));

export default function VoiceHero() {
  const [messages, setMessages] = useState<Message[]>([]);

  const voice = useBrowserVoice({
    onTurn: (user, reply) => {
      setMessages((prev) => {
        const next = [...prev];
        if (user.trim()) next.push({ role: "user", text: user.trim() });
        next.push({ role: "assistant", text: reply });
        return next;
      });
    },
  });

  // Persisted visualization + view mode + intensity.
  const [variant, setVariant] = useState<string>(DEFAULT_VARIANT);
  const [view, setView] = useState<string>("full");
  const [intensity, setIntensity] = useState<number>(0.65);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const v = localStorage.getItem(VARIANT_KEY);
      if (v && VIZ_IDS.has(v)) setVariant(v);
      const w = localStorage.getItem(VIEW_KEY);
      if (w && VIEW_IDS.has(w)) setView(w);
      const n = parseFloat(localStorage.getItem(INTENSITY_KEY) ?? "");
      if (!isNaN(n)) setIntensity(n);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const chooseVariant = useCallback((v: string) => {
    setVariant(v);
    localStorage.setItem(VARIANT_KEY, v);
  }, []);
  const chooseView = useCallback((v: string) => {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  }, []);
  const chooseIntensity = useCallback((n: number) => {
    setIntensity(n);
    localStorage.setItem(INTENSITY_KEY, String(n));
  }, []);

  const viewProps = {
    variant,
    state: voice.state,
    liveLevel: voice.liveLevelRef,
    voice,
    messages,
    intensity,
  };

  return (
    <main
      aria-label={`Voice assistant, ${view} view, currently ${voice.state}`}
      className="relative h-dvh w-full select-none overflow-hidden bg-black"
    >
      {view === "circle" ? (
        <CircleView {...viewProps} />
      ) : view === "chat" ? (
        <ChatView {...viewProps} />
      ) : (
        <FullView {...viewProps} />
      )}

      {/* Mic control + intensity slider — stacked, centered. */}
      {view !== "chat" && (
        <div className="absolute inset-x-0 bottom-10 z-20 flex flex-col items-center gap-5">
          <IntensityMeter value={intensity} onChange={chooseIntensity} />
          <MicButton
            state={voice.state}
            onStart={voice.startListening}
            onStop={voice.stopListening}
          />
        </div>
      )}

      {/* Top switchers: view mode + visualization. */}
      <div className="absolute inset-x-0 top-6 z-30 flex flex-wrap items-center justify-center gap-2 px-4">
        <WaveVariantSwitcher
          options={VIEW_OPTIONS}
          value={view}
          onChange={chooseView}
        />
        <WaveVariantSwitcher
          options={VIZ_OPTIONS}
          value={variant}
          onChange={chooseVariant}
        />
      </div>
    </main>
  );
}

function IntensityMeter({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const pct = Math.round(value * 100);
  return (
    <div className="pointer-events-auto flex flex-col items-center gap-2">
      <span className="text-[9px] font-light uppercase tracking-[0.32em] text-white/30">
        Intensity
      </span>
      <div className="relative flex items-center">
        {/* Glow layer behind the track */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 rounded-full blur-[6px]"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(to right, #C84A00, #F4B84A)",
            opacity: 0.55,
          }}
        />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          aria-label="Animation intensity"
          className="relative h-[3px] w-32 cursor-pointer appearance-none rounded-full outline-none focus-visible:ring-1 focus-visible:ring-white/30"
          style={{
            background: `linear-gradient(to right, #C84A00 0%, #F4B84A ${pct}%, rgba(255,255,255,0.12) ${pct}%)`,
          }}
        />
      </div>
    </div>
  );
}
