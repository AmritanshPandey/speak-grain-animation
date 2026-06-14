"use client";

/**
 * useBrowserVoice
 * ===============
 * A fully browser-native voice loop — no third-party service, no API keys, no
 * backend. It hears you and talks back using only Web platform APIs:
 *
 *   • getUserMedia + Web Audio AnalyserNode → a real 0–1 microphone level.
 *   • SpeechRecognition (webkit-prefixed)   → transcribes what you say.
 *   • speechSynthesis                        → speaks a reply aloud.
 *
 * State machine, one turn:
 *   listening → (final transcript) → thinking → speaking → listening …
 *
 * The wave is driven through `liveLevelRef` (read every frame by the
 * visualizer):
 *   • listening — the real mic RMS, so the wave tracks your actual voice.
 *   • speaking  — a per-word pulse seeded by utterance `onboundary` events
 *                 (speechSynthesis output can't be metered by Web Audio, so
 *                 word events are the available real signal); decays between
 *                 words, with a low idle floor so the wave stays alive.
 *   • idle / thinking — null, so the visualizer falls back to its synthesized
 *                 cadence (gentle idle, or the thinking churn).
 *
 * Robustness: recognition is restarted with a debounce (never a tight loop),
 * repeated fatal errors fall the whole thing back to the ambient animation,
 * and speaking has a safety timeout for voices that never fire `onend`. If the
 * browser lacks SpeechRecognition (e.g. Firefox), `supported` is false and the
 * caller keeps the synthesized ambient loop.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceState } from "@/components/EmberWaveVisualizer";

/* --- Minimal Web Speech API typings (not in the standard TS lib) --------- */

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
  length: number;
}
interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}
interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/* --- Reply generator (no LLM) -------------------------------------------- */

/**
 * Tiny canned responder — pattern-matches a few intents, otherwise gives a
 * generic acknowledgement that echoes part of what was heard. Swap this out
 * for a real backend/LLM call later; nothing else in the loop needs to change.
 */
function generateReply(transcript: string): string {
  const t = transcript.trim().toLowerCase();
  if (!t) return "I didn't catch that — could you say it again?";
  if (/\b(hi|hey|hello|yo)\b/.test(t)) return "Hey there. What can I do for you?";
  if (/\bhow are you\b/.test(t)) return "Running smoothly, thanks for asking.";
  if (/\b(your name|who are you)\b/.test(t))
    return "I'm your ember voice assistant.";
  if (/\b(thanks|thank you)\b/.test(t)) return "Anytime.";
  if (/\b(bye|goodbye|stop)\b/.test(t)) return "Talk soon.";
  if (t.endsWith("?")) return "That's a good question. Let me think about it.";
  return `You said: ${transcript.trim()}.`;
}

/* --- The hook ------------------------------------------------------------ */

type Phase = "idle" | "listening" | "thinking" | "speaking";

export interface BrowserVoice {
  /** Current loop state, fed straight to the visualizer. */
  state: VoiceState;
  /** Read every frame by the visualizer; null → use synthesized cadence. */
  liveLevelRef: React.RefObject<(() => number) | null>;
  /** Live transcript of the current utterance (interim + final). */
  transcript: string;
  /** The reply currently being spoken (empty unless speaking). */
  reply: string;
  /** False when the browser lacks SpeechRecognition (caller keeps ambient). */
  supported: boolean;
  /** True while a live session is running (mic granted, loop healthy). */
  active: boolean;
  /** Begin the loop. Safe to call repeatedly; resolves false if mic denied. */
  start: () => Promise<boolean>;
}

/** How many consecutive fatal recognition errors before giving up on live. */
const MAX_FATAL_ERRORS = 5;

export function useBrowserVoice(): BrowserVoice {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [active, setActive] = useState(false);

  const supported =
    typeof window !== "undefined" &&
    getRecognitionCtor() !== null &&
    "speechSynthesis" in window;

  // Frame-read level source. Holds either a function (listening/speaking) or
  // null (idle/thinking → synthesized cadence).
  const liveLevelRef = useRef<(() => number) | null>(null);

  // Audio graph + recognition handles (refs so they survive re-renders).
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const freqRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Logical phase tracked in a ref so async handlers never read stale state
  // or trigger render storms.
  const phaseRef = useRef<Phase>("idle");
  const transcriptRef = useRef("");
  const runningRef = useRef(false); // session alive?
  const recActiveRef = useRef(false); // recognition currently started?
  const fatalCount = useRef(0);
  const thinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speakSafety = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-word speaking envelope: bumped on each boundary, decays over time.
  const speakPulse = useRef({ level: 0, at: 0 });

  /** RMS-ish loudness from the analyser, mapped to a lively 0–1. */
  const micLevel = useCallback(() => {
    const analyser = analyserRef.current;
    const buf = freqRef.current;
    if (!analyser || !buf) return 0;
    analyser.getByteFrequencyData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length) / 255; // 0–1
    // Punchy expansion: quiet speech still registers, but louder moments
    // drive hard toward the top so the wave reacts dramatically.
    return Math.min(1, Math.pow(rms, 0.6) * 2.8);
  }, []);

  /** Decaying per-word pulse with a low floor so speaking always shimmers. */
  const speakLevel = useCallback(() => {
    const { level, at } = speakPulse.current;
    const elapsed = (performance.now() - at) / 1000;
    const decayed = level * Math.exp(-elapsed / 0.18);
    return Math.min(1, 0.14 + decayed);
  }, []);

  /** Tear the live session down and hand the screen back to the ambient loop. */
  const goAmbient = useCallback(() => {
    runningRef.current = false;
    recActiveRef.current = false;
    phaseRef.current = "idle";
    if (restartTimer.current) clearTimeout(restartTimer.current);
    if (thinkTimer.current) clearTimeout(thinkTimer.current);
    if (speakSafety.current) clearTimeout(speakSafety.current);
    liveLevelRef.current = null;
    try {
      recognitionRef.current?.abort();
    } catch {
      /* noop */
    }
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* noop */
    }
    setActive(false);
    setState("idle");
  }, []);

  /** (Re)start recognition and enter the listening state. */
  const beginListening = useCallback(() => {
    if (!runningRef.current) return;
    const rec = recognitionRef.current;
    if (!rec) return;
    transcriptRef.current = "";
    setTranscript("");
    phaseRef.current = "listening";
    setState("listening");
    liveLevelRef.current = micLevel;
    if (recActiveRef.current) return; // already running
    try {
      rec.start();
      recActiveRef.current = true;
    } catch {
      // start() throws if it's mid-stop; onend will schedule the next start.
    }
  }, [micLevel]);

  /** Debounced restart so a flaky engine can never spin in a tight loop. */
  const scheduleRestart = useCallback(() => {
    if (!runningRef.current) return;
    if (restartTimer.current) clearTimeout(restartTimer.current);
    restartTimer.current = setTimeout(() => {
      if (phaseRef.current === "listening") beginListening();
    }, 280);
  }, [beginListening]);

  /** Speak a reply, driving the wave from word boundaries; then resume. */
  const speak = useCallback(
    (text: string) => {
      if (!runningRef.current) return;
      setReply(text);
      phaseRef.current = "speaking";
      setState("speaking");
      liveLevelRef.current = speakLevel;
      speakPulse.current = { level: 0.6, at: performance.now() };

      const finish = () => {
        if (speakSafety.current) clearTimeout(speakSafety.current);
        if (phaseRef.current !== "speaking") return; // already moved on
        liveLevelRef.current = null;
        setReply("");
        beginListening();
      };

      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0;
      u.pitch = 1.0;
      u.onboundary = (e: SpeechSynthesisEvent) => {
        speakPulse.current = {
          level: 0.55 + Math.min(0.4, (e.charLength ?? 4) * 0.04),
          at: performance.now(),
        };
      };
      u.onend = finish;
      u.onerror = finish;

      try {
        window.speechSynthesis.cancel(); // clear any stuck queue
        window.speechSynthesis.speak(u);
      } catch {
        finish();
        return;
      }

      // Safety: some voices never fire onend. Estimate the utterance length
      // (~165 wpm) and force a return to listening if it overruns.
      const words = text.trim().split(/\s+/).length;
      const estMs = Math.min(20000, 1200 + (words / 165) * 60000);
      if (speakSafety.current) clearTimeout(speakSafety.current);
      speakSafety.current = setTimeout(finish, estMs);
    },
    [speakLevel, beginListening]
  );

  const start = useCallback(async (): Promise<boolean> => {
    if (runningRef.current) return true;
    if (!supported) return false;

    // 1. Microphone + analyser.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return false; // denied / unavailable → caller keeps ambient
    }
    streamRef.current = stream;
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctx();
    audioCtxRef.current = ctx;
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    ctx.createMediaStreamSource(stream).connect(analyser);
    analyserRef.current = analyser;
    freqRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

    // 2. Speech recognition.
    const Ctor = getRecognitionCtor()!;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = true;

    rec.onresult = (e: SpeechRecognitionEventLike) => {
      if (phaseRef.current !== "listening") return;
      fatalCount.current = 0; // a real result → engine is healthy
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      const text = (final || interim).trim();
      transcriptRef.current = text;
      setTranscript(text);

      if (final && text) {
        // User finished a phrase → think briefly, then reply.
        try {
          rec.stop();
        } catch {
          /* noop */
        }
        phaseRef.current = "thinking";
        liveLevelRef.current = null; // thinking uses synthesized churn
        setState("thinking");
        if (thinkTimer.current) clearTimeout(thinkTimer.current);
        thinkTimer.current = setTimeout(
          () => speak(generateReply(transcriptRef.current)),
          700 + Math.random() * 400
        );
      }
    };

    rec.onerror = (e: SpeechRecognitionErrorEventLike) => {
      // "no-speech"/"aborted" are normal idle outcomes; only count outages.
      if (e.error !== "no-speech" && e.error !== "aborted") {
        fatalCount.current += 1;
      }
    };

    rec.onend = () => {
      recActiveRef.current = false;
      if (!runningRef.current) return;
      if (fatalCount.current >= MAX_FATAL_ERRORS) {
        goAmbient(); // engine unreachable (e.g. headless / offline) → ambient
        return;
      }
      if (phaseRef.current === "listening") scheduleRestart();
    };

    recognitionRef.current = rec;
    runningRef.current = true;
    fatalCount.current = 0;
    setActive(true);
    beginListening();
    return true;
  }, [supported, beginListening, speak, goAmbient]);

  // Teardown on unmount.
  useEffect(() => {
    return () => {
      runningRef.current = false;
      if (thinkTimer.current) clearTimeout(thinkTimer.current);
      if (restartTimer.current) clearTimeout(restartTimer.current);
      if (speakSafety.current) clearTimeout(speakSafety.current);
      try {
        recognitionRef.current?.abort();
      } catch {
        /* noop */
      }
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* noop */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  return { state, liveLevelRef, transcript, reply, supported, active, start };
}
