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
    hint: "A warm neon status halo with hybrid voice motion",
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

  // Persisted visualization + view mode.
  const [variant, setVariant] = useState<string>(DEFAULT_VARIANT);
  const [view, setView] = useState<string>("full");
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const v = localStorage.getItem(VARIANT_KEY);
      if (v && VIZ_IDS.has(v)) setVariant(v);
      const w = localStorage.getItem(VIEW_KEY);
      if (w && VIEW_IDS.has(w)) setView(w);
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

  const viewProps = {
    variant,
    state: voice.state,
    liveLevel: voice.liveLevelRef,
    voice,
    messages,
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

      {/* Mic control — one fixed position shared by Full and Circle views. */}
      {view !== "chat" && (
        <div className="absolute inset-x-0 bottom-12 z-20 flex justify-center">
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
