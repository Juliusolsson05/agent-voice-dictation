import type { SpeechTraceEvent, SpeechTranscript } from 'agent-voice-dictation'
import type { SttProviderId } from '@main/services/settingsStore.js'

export type ProviderTrace = {
  phase: string
  details: Record<string, unknown>
}

export type BatchTranscribeInput = {
  apiKey: string
  audio: ArrayBuffer
  mimeType?: string
  language: 'en'
  onTrace: (event: SpeechTraceEvent) => void
}

export type StreamingStartInput = {
  apiKey: string
  mimeType?: string
  onTrace: (event: ProviderTrace) => void
}

export type StreamingTranscript = {
  id: string
  startedAt: number
  raw: string
  provider: SttProviderId
  model: string | null
  sttDoneAt: number
  audioDurationMs?: number | null
}

export type StreamingProvider = {
  start(input: StreamingStartInput): { id: string }
  pushChunk(id: string, chunk: ArrayBuffer): void
  stop(id: string): Promise<StreamingTranscript>
  cancel(id: string): void
}

export type SpeechProviderRuntime = {
  id: SttProviderId
  secretId: string
  transcribe(input: BatchTranscribeInput): Promise<SpeechTranscript>
  streaming?: StreamingProvider
}
