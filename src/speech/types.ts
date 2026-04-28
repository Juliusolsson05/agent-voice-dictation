export type SpeechProviderId =
  | 'assemblyai'
  | 'deepgram'
  | 'openai'
  | 'gladia'
  | 'elevenlabs'

export type AudioInput = {
  /** Binary audio. Host apps choose whether this came from a browser
   *  MediaRecorder Blob, a file read into ArrayBuffer, or another
   *  source. The speech clients deliberately accept raw bytes instead
   *  of owning recording because browser capture and provider upload
   *  are separate failure domains. */
  data: Blob | ArrayBuffer | Uint8Array
  mimeType?: string
  filename?: string
}

export type WordTiming = {
  text: string
  startMs?: number | undefined
  endMs?: number | undefined
  speaker?: string | undefined
  confidence?: number | undefined
}

export type Utterance = {
  text: string
  startMs?: number | undefined
  endMs?: number | undefined
  speaker?: string | undefined
  confidence?: number | undefined
  words?: WordTiming[] | undefined
}

export type SpeechTranscript = {
  provider: SpeechProviderId
  text: string
  language?: string | undefined
  durationMs?: number | undefined
  words?: WordTiming[] | undefined
  utterances?: Utterance[] | undefined
  /** Keep the upstream payload available for debugging and future
   *  provider-specific features, but never make callers depend on it
   *  for the common path. Each STT API has a different shape; the
   *  normalized fields above are the stable package contract. */
  raw?: unknown
}

export type TranscribeOptions = {
  apiKey: string
  audio: AudioInput
  signal?: AbortSignal | undefined
  language?: string | undefined
  /** Optional diagnostic hook for host apps that need provider-internal latency
   *  without coupling to provider-specific response payloads. The Electron app
   *  uses this to print terminal logs from the main process while keeping the
   *  reusable STT clients free of Electron-specific logging decisions. */
  onTrace?: ((event: SpeechTraceEvent) => void) | undefined
  /** Provider-specific knobs live behind a loose object on purpose.
   *  V1 should not normalize every option across providers because
   *  that creates fake portability. Callers can use this for model
   *  names, diarization flags, keyterms, and similar escape hatches. */
  providerOptions?: Record<string, unknown> | undefined
}

export type SpeechTraceEvent = {
  provider: SpeechProviderId
  phase: string
  ms?: number
  [key: string]: unknown
}

export type SpeechProvider = {
  id: SpeechProviderId
  transcribe(options: TranscribeOptions): Promise<SpeechTranscript>
}
