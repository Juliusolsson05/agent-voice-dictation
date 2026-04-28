import { assertApiKey, readErrorBody, SpeechProviderError } from './errors.js'
import { audioToBody, numberMs } from './http.js'
import type { SpeechProvider, SpeechTranscript, TranscribeOptions } from './types.js'

type AssemblyAiTranscriptResponse = {
  id: string
  status: 'queued' | 'processing' | 'completed' | 'error'
  text?: string
  error?: string
  language_code?: string
  audio_duration?: number
  utterances?: Array<{
    text: string
    start?: number
    end?: number
    speaker?: string
    confidence?: number
    words?: Array<{
      text: string
      start?: number
      end?: number
      speaker?: string
      confidence?: number
    }>
  }>
}

export type AssemblyAiOptions = {
  baseUrl?: string
  speechModels?: string[]
  languageDetection?: boolean
  speakerLabels?: boolean
  pollIntervalMs?: number
  timeoutMs?: number
}

export function createAssemblyAiProvider(defaults: AssemblyAiOptions = {}): SpeechProvider {
  return {
    id: 'assemblyai',
    async transcribe(options) {
      return transcribeAssemblyAi({ ...defaults, ...options.providerOptions }, options)
    },
  }
}

export async function transcribeAssemblyAi(
  providerOptions: AssemblyAiOptions,
  options: TranscribeOptions,
): Promise<SpeechTranscript> {
  assertApiKey('assemblyai', options.apiKey)
  const baseUrl = providerOptions.baseUrl ?? 'https://api.assemblyai.com'
  const headers = { authorization: options.apiKey }

  // AssemblyAI's batch API is upload-url-first unless the caller
  // already has a public `audio_url`. Host apps usually have a local
  // MediaRecorder blob, so v1 owns the upload step here and keeps the
  // public package API simple: bytes in, transcript out.
  const upload = await fetch(`${baseUrl}/v2/upload`, {
    method: 'POST',
    headers,
    body: audioToBody(options.audio),
    signal: options.signal ?? null,
  })
  if (!upload.ok) {
    throw new SpeechProviderError('assemblyai', 'AssemblyAI upload failed', {
      status: upload.status,
      details: await readErrorBody(upload),
    })
  }
  const uploadJson = await upload.json() as { upload_url?: string }
  if (!uploadJson.upload_url) {
    throw new SpeechProviderError('assemblyai', 'AssemblyAI upload did not return upload_url', {
      details: uploadJson,
    })
  }

  const create = await fetch(`${baseUrl}/v2/transcript`, {
    method: 'POST',
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: uploadJson.upload_url,
      // AssemblyAI used to accept the singular `speech_model` field, and
      // Electron builds can hide that mistake until the provider rejects a real
      // dictation run with a 400. Their current pre-recorded API expects
      // `speech_models` on every request, as a priority-ordered array, so keep
      // the package boundary aligned with the provider contract instead of
      // letting each host app remember this migration detail.
      speech_models: nonEmptySpeechModels(providerOptions.speechModels),
      language_detection: providerOptions.languageDetection ?? !options.language,
      language_code: options.language,
      speaker_labels: providerOptions.speakerLabels ?? false,
    }),
    signal: options.signal ?? null,
  })
  if (!create.ok) {
    throw new SpeechProviderError('assemblyai', 'AssemblyAI transcript creation failed', {
      status: create.status,
      details: await readErrorBody(create),
    })
  }
  const created = await create.json() as { id?: string }
  if (!created.id) {
    throw new SpeechProviderError('assemblyai', 'AssemblyAI transcript creation did not return id', {
      details: created,
    })
  }

  const started = Date.now()
  const pollIntervalMs = providerOptions.pollIntervalMs ?? 1500
  const timeoutMs = providerOptions.timeoutMs ?? 120_000
  for (;;) {
    if (Date.now() - started > timeoutMs) {
      throw new SpeechProviderError('assemblyai', 'AssemblyAI transcript polling timed out')
    }
    await sleep(pollIntervalMs, options.signal)
    const poll = await fetch(`${baseUrl}/v2/transcript/${created.id}`, {
      headers,
      signal: options.signal ?? null,
    })
    if (!poll.ok) {
      throw new SpeechProviderError('assemblyai', 'AssemblyAI transcript poll failed', {
        status: poll.status,
        details: await readErrorBody(poll),
      })
    }
    const result = await poll.json() as AssemblyAiTranscriptResponse
    if (result.status === 'error') {
      throw new SpeechProviderError('assemblyai', result.error ?? 'AssemblyAI transcript failed', {
        details: result,
      })
    }
    if (result.status === 'completed') return normalizeAssemblyAi(result)
  }
}

function nonEmptySpeechModels(speechModels: string[] | undefined): string[] {
  if (speechModels?.length) return speechModels

  // Default the package to the faster async model. Universal-3 Pro is the
  // quality-first AssemblyAI model and is the right choice for offline notes,
  // long recordings, or hard audio, but it made the Electron dictation loop feel
  // painfully slow because our current UX is batch upload -> create job -> poll.
  // Until the app moves to the streaming `u3-rt-pro` path, v1 should optimize
  // for perceived latency. Callers can still opt into Pro with
  // `speechModels: ['universal-3-pro', 'universal-2']` when quality matters more.
  return ['universal-2']
}

function normalizeAssemblyAi(result: AssemblyAiTranscriptResponse): SpeechTranscript {
  return {
    provider: 'assemblyai',
    text: result.text ?? '',
    language: result.language_code,
    durationMs: numberMs(result.audio_duration),
    utterances: result.utterances?.map(utterance => ({
      text: utterance.text,
      startMs: numberMs(utterance.start),
      endMs: numberMs(utterance.end),
      speaker: utterance.speaker,
      confidence: utterance.confidence,
      words: utterance.words?.map(word => ({
        text: word.text,
        startMs: numberMs(word.start),
        endMs: numberMs(word.end),
        speaker: word.speaker,
        confidence: word.confidence,
      })),
    })),
    raw: result,
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    }, { once: true })
  })
}
