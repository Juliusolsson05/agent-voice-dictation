import type { PolishTranscriptOptions, PolishedTranscript, RecentContext } from '../openrouter/types.js'
import type { AudioInput, SpeechProvider, SpeechTraceEvent, SpeechTranscript } from '../speech/types.js'

export type DictationPipelineOptions = {
  speechProvider: SpeechProvider
  speechApiKey: string
  audio: AudioInput
  language?: string
  recentContext?: RecentContext
  polish?: false | {
    openRouterApiKey: string
    model?: string
    baseUrl?: string
    appTitle?: string
    appReferer?: string
  }
  signal?: AbortSignal
  /** Forwarded to the speech provider so package consumers (Agent Code)
   *  can observe per-phase latency without subscribing to the provider
   *  directly. We intentionally do NOT add a separate pipeline-level
   *  trace channel: the existing SpeechTraceEvent shape carries the
   *  provider id and phase, and adding a parallel taxonomy would just
   *  duplicate work for callers wiring up a single console log. */
  onTrace?: (event: SpeechTraceEvent) => void
}

export type DictationResult = {
  transcript: SpeechTranscript
  polished?: PolishedTranscript
  text: string
  timing: {
    sttMs: number
    polishMs?: number
    totalMs: number
  }
}

export type TranscriptPolishRequest = Omit<PolishTranscriptOptions, 'rawTranscript'>
