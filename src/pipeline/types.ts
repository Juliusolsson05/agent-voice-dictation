import type { PolishTranscriptOptions, PolishedTranscript, RecentContext } from '../openrouter/types.js'
import type { AudioInput, SpeechProvider, SpeechTranscript } from '../speech/types.js'

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
