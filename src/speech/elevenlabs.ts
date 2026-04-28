import { assertApiKey, readErrorBody, SpeechProviderError } from './errors.js'
import { fileName, formFile, numberSecondsToMs } from './http.js'
import type { SpeechProvider, SpeechTranscript, TranscribeOptions } from './types.js'

export type ElevenLabsOptions = {
  baseUrl?: string
  modelId?: string
  languageCode?: string
  tagAudioEvents?: boolean
  diarize?: boolean
}

export function createElevenLabsProvider(defaults: ElevenLabsOptions = {}): SpeechProvider {
  return {
    id: 'elevenlabs',
    async transcribe(options) {
      return transcribeElevenLabs({ ...defaults, ...options.providerOptions }, options)
    },
  }
}

export async function transcribeElevenLabs(
  providerOptions: ElevenLabsOptions,
  options: TranscribeOptions,
): Promise<SpeechTranscript> {
  assertApiKey('elevenlabs', options.apiKey)
  const form = new FormData()
  form.set('file', formFile(options.audio, 'audio.webm'), fileName(options.audio, 'audio.webm'))
  form.set('model_id', providerOptions.modelId ?? 'scribe_v1')
  form.set('tag_audio_events', String(providerOptions.tagAudioEvents ?? true))
  form.set('diarize', String(providerOptions.diarize ?? false))
  const languageCode = providerOptions.languageCode ?? options.language
  if (languageCode) form.set('language_code', languageCode)

  const response = await fetch(`${providerOptions.baseUrl ?? 'https://api.elevenlabs.io'}/v1/speech-to-text`, {
    method: 'POST',
    headers: {
      'xi-api-key': options.apiKey,
    },
    body: form,
    signal: options.signal ?? null,
  })
  if (!response.ok) {
    throw new SpeechProviderError('elevenlabs', 'ElevenLabs transcription failed', {
      status: response.status,
      details: await readErrorBody(response),
    })
  }
  const raw = await response.json() as Record<string, unknown>
  return {
    provider: 'elevenlabs',
    text: String(raw.text ?? ''),
    language: typeof raw.language_code === 'string' ? raw.language_code : languageCode,
    words: Array.isArray(raw.words)
      ? raw.words.map(word => {
          const w = word as Record<string, unknown>
          return {
            text: String(w.text ?? ''),
            startMs: numberSecondsToMs(w.start),
            endMs: numberSecondsToMs(w.end),
            speaker: typeof w.speaker_id === 'string' ? w.speaker_id : undefined,
          }
        })
      : undefined,
    raw,
  }
}
