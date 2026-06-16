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
 * Explicit one-turn control:
 *   idle → startListening() → listening → stopListening()
 *        → thinking → speaking → idle
 *
 * The mic session (stream + analyser + recognition) is acquired on the first
 * startListening() — a real user gesture, which also unlocks speechSynthesis —
 * and kept alive across turns. Recognition is `continuous`, so a turn keeps
 * accumulating until you press stop; the reply is generated and spoken, then it
 * rests at idle (no auto-loop).
 *
 * The wave is driven through `liveLevelRef` (read every frame by the visualizer):
 *   • listening — the real mic RMS, so the wave tracks your actual voice.
 *   • speaking  — a per-word pulse seeded by utterance `onboundary` events.
 *   • idle / thinking — null, so the visualizer uses its synthesized cadence.
 *
 * If the browser lacks SpeechRecognition (e.g. Firefox), `supported` is false.
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

function canUseMicrophone() {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    window.isSecureContext &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
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
  if (/\b(bye|goodbye)\b/.test(t)) return "Talk soon.";
  if (t.endsWith("?")) return "That's a good question. Let me think about it.";
  return `You said: ${transcript.trim()}.`;
}

/* --- The hook ------------------------------------------------------------ */

type Phase = "idle" | "listening" | "thinking" | "speaking";

/** How many consecutive fatal recognition errors before a turn gives up. */
const MAX_FATAL_ERRORS = 5;

export interface UseBrowserVoiceOptions {
  /** Fired once per turn when a reply is produced (user text, reply text). */
  onTurn?: (userText: string, replyText: string) => void;
}

export interface BrowserVoice {
  /** Current state, fed straight to the visualizer. */
  state: VoiceState;
  /** Read every frame by the visualizer; null → use synthesized cadence. */
  liveLevelRef: React.RefObject<(() => number) | null>;
  /** Live transcript of the current utterance (interim + final). */
  transcript: string;
  /** The reply currently being spoken (empty unless speaking). */
  reply: string;
  /** False when the browser lacks SpeechRecognition / speechSynthesis. */
  supported: boolean;
  /** True while actively capturing the mic. */
  listening: boolean;
  /** True while a turn is in progress (listening, thinking, or speaking). */
  active: boolean;
  /** Begin capturing a turn. Resolves false if mic denied / unsupported. */
  startListening: () => Promise<boolean>;
  /** End capture → think → speak the reply → idle. */
  stopListening: () => void;
  /** Last browser capability or permission issue, if any. */
  error: string | null;
}

export function useBrowserVoice(
  options: UseBrowserVoiceOptions = {}
): BrowserVoice {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");

  const supported =
    canUseMicrophone() &&
    typeof window !== "undefined" &&
    "speechSynthesis" in window;
  const [error, setError] = useState<string | null>(null);

  // Keep the latest onTurn without re-creating callbacks.
  const onTurnRef = useRef(options.onTurn);
  useEffect(() => {
    onTurnRef.current = options.onTurn;
  }, [options.onTurn]);

  // Frame-read level source. A function while listening/speaking, else null.
  const liveLevelRef = useRef<(() => number) | null>(null);

  // Audio graph + recognition handles (refs so they survive re-renders).
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const freqRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const sessionReadyRef = useRef(false);

  // Logical phase tracked in a ref so async handlers never read stale state.
  const phaseRef = useRef<Phase>("idle");
  const transcriptRef = useRef("");
  const recActiveRef = useRef(false); // recognition currently started?
  const stopRequestedRef = useRef(false); // user pressed stop this turn?
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
    return Math.min(1, Math.pow(rms, 0.6) * 2.8);
  }, []);

  /** Decaying per-word pulse with a low floor so speaking always shimmers. */
  const speakLevel = useCallback(() => {
    const { level, at } = speakPulse.current;
    const elapsed = (performance.now() - at) / 1000;
    const decayed = level * Math.exp(-elapsed / 0.18);
    return Math.min(1, 0.14 + decayed);
  }, []);

  /** Settle to idle, ready for the next turn. */
  const toIdle = useCallback(() => {
    phaseRef.current = "idle";
    liveLevelRef.current = null;
    setState("idle");
  }, []);

  /** Visual-only fallback so the control never feels dead in Chrome. */
  const beginFallbackListening = useCallback((message: string) => {
    setError(message);
    stopRequestedRef.current = false;
    fatalCount.current = 0;
    transcriptRef.current = "";
    setTranscript("");
    setReply("");
    phaseRef.current = "listening";
    setState("listening");
    liveLevelRef.current = null;
    return true;
  }, []);

  /** Speak a reply, driving the wave from word boundaries; then idle. */
  const speak = useCallback(
    (text: string) => {
      setReply(text);
      phaseRef.current = "speaking";
      setState("speaking");
      liveLevelRef.current = speakLevel;
      speakPulse.current = { level: 0.6, at: performance.now() };

      const finish = () => {
        if (speakSafety.current) clearTimeout(speakSafety.current);
        if (phaseRef.current !== "speaking") return; // already moved on
        setReply("");
        toIdle();
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
      // (~165 wpm) and force idle if it overruns.
      const words = text.trim().split(/\s+/).length;
      const estMs = Math.min(20000, 1200 + (words / 165) * 60000);
      if (speakSafety.current) clearTimeout(speakSafety.current);
      speakSafety.current = setTimeout(finish, estMs);
    },
    [speakLevel, toIdle]
  );

  /** Debounced recognition restart so a flaky engine never tight-loops. */
  const scheduleRestart = useCallback(() => {
    if (restartTimer.current) clearTimeout(restartTimer.current);
    restartTimer.current = setTimeout(() => {
      const rec = recognitionRef.current;
      if (!rec || phaseRef.current !== "listening" || stopRequestedRef.current) {
        return;
      }
      try {
        rec.start();
        recActiveRef.current = true;
      } catch {
        /* will retry on the next onend */
      }
    }, 280);
  }, []);

  /** Build mic + analyser + recognition once; reused across turns. */
  const ensureSession = useCallback(async (): Promise<boolean> => {
    if (sessionReadyRef.current) return true;
    if (!canUseMicrophone()) return false;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return false; // denied / unavailable
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

    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      sessionReadyRef.current = true;
      setError("Speech recognition is unavailable; using microphone level only.");
      return true;
    }

    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true; // accumulate the whole turn until explicit stop
    rec.interimResults = true;

    rec.onresult = (e: SpeechRecognitionEventLike) => {
      if (phaseRef.current !== "listening") return;
      fatalCount.current = 0;
      // Continuous mode keeps every segment in `results`; concatenate them all
      // for the cumulative utterance.
      let full = "";
      for (let i = 0; i < e.results.length; i++) {
        full += e.results[i][0].transcript;
      }
      const text = full.trim();
      transcriptRef.current = text;
      setTranscript(text);
    };

    rec.onerror = (e: SpeechRecognitionErrorEventLike) => {
      if (e.error !== "no-speech" && e.error !== "aborted") {
        fatalCount.current += 1;
      }
    };

    rec.onend = () => {
      recActiveRef.current = false;
      if (phaseRef.current !== "listening" || stopRequestedRef.current) return;
      if (fatalCount.current >= MAX_FATAL_ERRORS) {
        toIdle(); // engine unreachable (e.g. headless / offline) → give up
        return;
      }
      scheduleRestart(); // keep the mic open during a listening turn
    };

    recognitionRef.current = rec;
    sessionReadyRef.current = true;
    setError(null);
    return true;
  }, [scheduleRestart, toIdle]);

  const startListening = useCallback(async (): Promise<boolean> => {
    if (phaseRef.current === "listening") return true;
    const ok = await ensureSession();
    if (!ok) {
      return beginFallbackListening(
        "Microphone access is unavailable; using simulated listening."
      );
    }

    stopRequestedRef.current = false;
    fatalCount.current = 0;
    transcriptRef.current = "";
    setTranscript("");
    setReply("");
    phaseRef.current = "listening";
    setState("listening");
    liveLevelRef.current = micLevel;

    const rec = recognitionRef.current;
    if (rec && !recActiveRef.current) {
      try {
        rec.start();
        recActiveRef.current = true;
      } catch {
        setError("Speech recognition could not start; using microphone level only.");
      }
    }
    return true;
  }, [beginFallbackListening, ensureSession, micLevel]);

  const stopListening = useCallback(() => {
    if (phaseRef.current !== "listening") return;
    stopRequestedRef.current = true;
    if (restartTimer.current) clearTimeout(restartTimer.current);
    try {
      recognitionRef.current?.stop();
    } catch {
      /* noop */
    }
    recActiveRef.current = false;

    const text = transcriptRef.current.trim();
    phaseRef.current = "thinking";
    liveLevelRef.current = null; // thinking uses the synthesized churn
    setState("thinking");

    if (thinkTimer.current) clearTimeout(thinkTimer.current);
    thinkTimer.current = setTimeout(
      () => {
        const replyText = generateReply(text);
        onTurnRef.current?.(text, replyText);
        speak(replyText);
      },
      700 + Math.random() * 400
    );
  }, [speak]);

  // Teardown on unmount.
  useEffect(() => {
    return () => {
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
      sessionReadyRef.current = false;
    };
  }, []);

  return {
    state,
    liveLevelRef,
    transcript,
    reply,
    supported,
    listening: state === "listening",
    active: state !== "idle",
    startListening,
    stopListening,
    error,
  };
}
