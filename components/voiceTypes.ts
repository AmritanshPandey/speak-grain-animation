import type { VoiceState } from "@/components/EmberWaveVisualizer";
import type { BrowserVoice } from "@/components/useBrowserVoice";

/** One line of the voice conversation, shown in the chat view. */
export interface Message {
  role: "user" | "assistant";
  text: string;
}

/** Everything a view needs to render the assistant in its own layout. */
export interface ViewProps {
  variant: string;
  state: VoiceState;
  liveLevel?: React.RefObject<(() => number) | null>;
  voice: BrowserVoice;
  messages: Message[];
}
