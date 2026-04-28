import { assertApiKey, readErrorBody, SpeechProviderError } from '../errors.js'
import { fileName, formFile, numberSecondsToMs } from '../http.js'
import type { SpeechProvider, SpeechTranscript, TranscribeOptions } from '../types.js'

export type GladiaOptions = {
  baseUrl?: string
  model?: string
  diarization?: boolean
  pollIntervalMs?: number
  timeoutMs?: number
}

export function createGladiaProvider(defaults: GladiaOptions = {}): SpeechProvider {
  return {
    id: 'gladia',
    async transcribe(options) {
      return transcribeGladia({ ...defaults, ...options.providerOptions }, options)
    },
  }
}

export async function transcribeGladia(
  providerOptions: GladiaOptions,
  options: TranscribeOptions,
): Promise<SpeechTranscript> {
  assertApiKey('gladia', options.apiKey)
  const baseUrl = providerOptions.baseUrl ?? 'https://api.gladia.io/v2'
  const headers = { 'x-gladia-key': options.apiKey }

  // Gladia v2 uses a separate upload step for local files before
  // pre-recorded transcription init. Keeping that step here mirrors
  // the AssemblyAI client: package callers pass bytes, not a public
  // URL they had to host somewhere else.
  const uploadForm = new FormData()
  uploadForm.set('audio', formFile(options.audio), fileName(options.audio, 'audio.webm'))
  const upload = await fetch(`${baseUrl}/upload`, {
    method: 'POST',
    headers,
    body: uploadForm,
    signal: options.signal ?? null,
  })
  if (!upload.ok) {
    throw new SpeechProviderError('gladia', 'Gladia upload failed', {
      status: upload.status,
      details: await readErrorBody(upload),
    })
  }
  const uploadJson = await upload.json() as { audio_url?: string }
  if (!uploadJson.audio_url) {
    throw new SpeechProviderError('gladia', 'Gladia upload did not return audio_url', {
      details: uploadJson,
    })
  }

  const init = await fetch(`${baseUrl}/pre-recorded`, {
    method: 'POST',
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: uploadJson.audio_url,
      language_config: options.language
        ? { languages: [options.language] }
        : { language_behaviour: 'automatic single language' },
      transcription_config: {
        model: providerOptions.model,
        diarization: providerOptions.diarization,
      },
    }),
    signal: options.signal ?? null,
  })
  if (!init.ok) {
    throw new SpeechProviderError('gladia', 'Gladia transcription init failed', {
      status: init.status,
      details: await readErrorBody(init),
    })
  }
  const created = await init.json() as { id?: string; result_url?: string }
  const resultUrl = created.result_url ?? (created.id ? `${baseUrl}/pre-recorded/${created.id}` : null)
  if (!resultUrl) {
    throw new SpeechProviderError('gladia', 'Gladia transcription init did not return job id', {
      details: created,
    })
  }

  const started = Date.now()
  const pollIntervalMs = providerOptions.pollIntervalMs ?? 1500
  const timeoutMs = providerOptions.timeoutMs ?? 120_000
  for (;;) {
    if (Date.now() - started > timeoutMs) {
      throw new SpeechProviderError('gladia', 'Gladia transcription polling timed out')
    }
    await sleep(pollIntervalMs, options.signal)
    const poll = await fetch(resultUrl, { headers, signal: options.signal ?? null })
    if (!poll.ok) {
      throw new SpeechProviderError('gladia', 'Gladia transcription poll failed', {
        status: poll.status,
        details: await readErrorBody(poll),
      })
    }
    const raw = await poll.json() as Record<string, unknown>
    const status = String(raw.status ?? '')
    if (status === 'done' || status === 'completed') return normalizeGladia(raw, options.language)
    if (status === 'error') {
      throw new SpeechProviderError('gladia', 'Gladia transcription failed', { details: raw })
    }
  }
}

function normalizeGladia(raw: Record<string, unknown>, language?: string): SpeechTranscript {
  const result = (raw.result ?? raw) as Record<string, unknown>
  const transcription = (result.transcription ?? result) as Record<string, unknown>
  const full = (transcription.full_transcript ?? transcription) as Record<string, unknown>
  const text = String(full.text ?? transcription.text ?? result.text ?? '')
  return {
    provider: 'gladia',
    text,
    language: typeof full.language === 'string' ? full.language : language,
    durationMs: numberSecondsToMs((result.metadata as Record<string, unknown> | undefined)?.audio_duration),
    raw,
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
