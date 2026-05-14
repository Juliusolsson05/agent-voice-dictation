import { assertApiKey, readErrorBody, SpeechProviderError } from '../errors.js'
import { audioToBody, numberSecondsToMs } from '../http.js'
import type { SpeechProvider, SpeechTranscript, TranscribeOptions } from '../types.js'
export * from './streaming.js'

export type DeepgramOptions = {
  baseUrl?: string
  model?: string
  diarize?: boolean
  smartFormat?: boolean
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  return Array.isArray(value) ? asRecord(value[0]) : null
}

export function createDeepgramProvider(defaults: DeepgramOptions = {}): SpeechProvider {
  return {
    id: 'deepgram',
    async transcribe(options) {
      return transcribeDeepgram({ ...defaults, ...options.providerOptions }, options)
    },
  }
}

export async function transcribeDeepgram(
  providerOptions: DeepgramOptions,
  options: TranscribeOptions,
): Promise<SpeechTranscript> {
  assertApiKey('deepgram', options.apiKey)
  const url = new URL(providerOptions.baseUrl ?? 'https://api.deepgram.com/v1/listen')
  url.searchParams.set('model', providerOptions.model ?? 'nova-3')
  if (providerOptions.diarize) url.searchParams.set('diarize', 'true')
  if (providerOptions.smartFormat ?? true) url.searchParams.set('smart_format', 'true')
  if (options.language) url.searchParams.set('language', options.language)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Token ${options.apiKey}`,
      'content-type': options.audio.mimeType ?? 'application/octet-stream',
    },
    body: audioToBody(options.audio),
    signal: options.signal ?? null,
  })
  if (!response.ok) {
    throw new SpeechProviderError('deepgram', 'Deepgram transcription failed', {
      status: response.status,
      details: await readErrorBody(response),
    })
  }
  const raw = asRecord(await response.json()) ?? {}
  const results = asRecord(raw.results)
  const channel = firstRecord(results?.channels) ?? {}
  const alternative = firstRecord(channel.alternatives) ?? {}
  return {
    provider: 'deepgram',
    text: String(alternative.transcript ?? ''),
    language: typeof results?.detected_language === 'string'
      ? results.detected_language
      : options.language,
    durationMs: numberSecondsToMs(asRecord(raw.metadata)?.duration),
    words: Array.isArray(alternative.words)
      ? alternative.words.map(word => {
          const w = asRecord(word) ?? {}
          return {
            text: String(w.word ?? w.punctuated_word ?? ''),
            startMs: numberSecondsToMs(w.start),
            endMs: numberSecondsToMs(w.end),
            speaker: typeof w.speaker === 'number' || typeof w.speaker === 'string'
              ? String(w.speaker)
              : undefined,
            confidence: typeof w.confidence === 'number' ? w.confidence : undefined,
          }
        })
      : undefined,
    raw,
  }
}
