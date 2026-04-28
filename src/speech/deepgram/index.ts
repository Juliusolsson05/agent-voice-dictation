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
  const raw = await response.json() as Record<string, unknown>
  const channel = (((raw.results as Record<string, unknown> | undefined)?.channels as unknown[])?.[0]
    ?? {}) as Record<string, unknown>
  const alternative = ((channel.alternatives as unknown[])?.[0] ?? {}) as Record<string, unknown>
  return {
    provider: 'deepgram',
    text: String(alternative.transcript ?? ''),
    language: ((raw.results as Record<string, unknown> | undefined)?.detected_language as string | undefined)
      ?? options.language,
    durationMs: numberSecondsToMs((raw.metadata as Record<string, unknown> | undefined)?.duration),
    words: Array.isArray(alternative.words)
      ? alternative.words.map(word => {
          const w = word as Record<string, unknown>
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
