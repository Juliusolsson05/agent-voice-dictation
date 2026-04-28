import { assertApiKey, readErrorBody, SpeechProviderError } from '../errors.js'
import { fileName, formFile, numberSecondsToMs } from '../http.js'
import type { SpeechProvider, SpeechTranscript, TranscribeOptions } from '../types.js'

export type OpenAiSttOptions = {
  baseUrl?: string
  model?: string
  responseFormat?: 'json' | 'verbose_json'
  prompt?: string
}

export function createOpenAiSpeechProvider(defaults: OpenAiSttOptions = {}): SpeechProvider {
  return {
    id: 'openai',
    async transcribe(options) {
      return transcribeOpenAi({ ...defaults, ...options.providerOptions }, options)
    },
  }
}

export async function transcribeOpenAi(
  providerOptions: OpenAiSttOptions,
  options: TranscribeOptions,
): Promise<SpeechTranscript> {
  assertApiKey('openai', options.apiKey)
  const form = new FormData()
  form.set('file', formFile(options.audio), fileName(options.audio, 'audio.webm'))
  form.set('model', providerOptions.model ?? 'gpt-4o-mini-transcribe')
  form.set('response_format', providerOptions.responseFormat ?? 'verbose_json')
  if (providerOptions.prompt) form.set('prompt', providerOptions.prompt)
  if (options.language) form.set('language', options.language)

  const response = await fetch(`${providerOptions.baseUrl ?? 'https://api.openai.com/v1'}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.apiKey}`,
    },
    body: form,
    signal: options.signal ?? null,
  })
  if (!response.ok) {
    throw new SpeechProviderError('openai', 'OpenAI transcription failed', {
      status: response.status,
      details: await readErrorBody(response),
    })
  }
  const raw = await response.json() as Record<string, unknown>
  const segments = Array.isArray(raw.segments) ? raw.segments : []
  return {
    provider: 'openai',
    text: String(raw.text ?? ''),
    language: typeof raw.language === 'string' ? raw.language : options.language,
    durationMs: numberSecondsToMs(raw.duration),
    words: segments.flatMap(segment => {
      const s = segment as Record<string, unknown>
      if (!Array.isArray(s.words)) return []
      return s.words.map(word => {
        const w = word as Record<string, unknown>
        return {
          text: String(w.word ?? ''),
          startMs: numberSecondsToMs(w.start),
          endMs: numberSecondsToMs(w.end),
        }
      })
    }),
    raw,
  }
}
