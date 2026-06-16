"use client";

/**
 * ChatView
 * ========
 * A ChatGPT-style voice conversation. The spoken turns appear as bubbles (your
 * transcript on the right, the assistant's reply on the left); a small orb in
 * the header reflects the live state; a mic composer at the bottom drives one
 * turn at a time. Voice-only — no typed input.
 */

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import MicButton from "@/components/MicButton";
import WaveStage from "@/components/WaveStage";
import type { ViewProps } from "@/components/voiceTypes";

export default function ChatView({
  variant,
  state,
  liveLevel,
  voice,
  messages,
}: ViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Tentative user bubble while listening.
  const pending = state === "listening" ? voice.transcript : "";

  // Auto-scroll to the newest message / live activity.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, pending, state]);

  const empty = messages.length === 0 && !pending;

  return (
    <div className="absolute inset-0 mx-auto flex max-w-2xl flex-col">
      {/* Header: live orb + title */}
      <div className="flex items-center gap-3 px-5 pb-3 pt-20">
        <div className="relative h-12 w-12 overflow-hidden rounded-full border border-white/10">
          <WaveStage variant={variant} state={state} liveLevel={liveLevel} />
          <div
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{ boxShadow: "inset 0 0 18px 4px rgba(0,0,0,0.6)" }}
          />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-medium text-white/80">
            Ember Assistant
          </span>
          <span className="text-[11px] font-light text-white/35">
            {state === "idle" ? "Ready" : state[0].toUpperCase() + state.slice(1)}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto px-5 py-4"
      >
        {empty && (
          <div className="flex h-full flex-col items-center justify-center text-center text-white/30">
            <p className="text-sm font-light">
              Tap the mic and start talking.
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} text={m.text} />
        ))}

        <AnimatePresence>
          {pending && <Bubble role="user" text={pending} tentative />}
        </AnimatePresence>
      </div>

      {/* Composer */}
      <div className="flex justify-center border-t border-white/[0.06] bg-black/40 px-5 py-5 backdrop-blur-md">
        <MicButton
          state={state}
          onStart={voice.startListening}
          onStop={voice.stopListening}
          size={64}
        />
      </div>
    </div>
  );
}

function Bubble({
  role,
  text,
  tentative = false,
}: {
  role: "user" | "assistant";
  text: string;
  tentative?: boolean;
}) {
  const user = role === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: tentative ? 0.6 : 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={`flex ${user ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-[15px] font-light leading-relaxed ${
          user
            ? "rounded-br-sm bg-[#C89445]/[0.16] text-[#F6E4C5]"
            : "rounded-bl-sm bg-white/[0.06] text-white/85"
        }`}
      >
        {text}
        {tentative && <span className="ml-1 animate-pulse text-white/40">▍</span>}
      </div>
    </motion.div>
  );
}
