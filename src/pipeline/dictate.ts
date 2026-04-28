import { polishTranscriptWithOpenRouter } from '../openrouter/client.js'
import type { DictationPipelineOptions, DictationResult } from './types.js'

export async function dictate(options: DictationPipelineOptions): Promise<DictationResult> {
  const started = Date.now()
  const sttStarted = Date.now()
  const transcript = await options.speechProvider.transcribe({
    apiKey: options.speechApiKey,
    audio: options.audio,
    language: options.language,
    signal: options.signal,
    onTrace: options.onTrace,
  })
  const sttMs = Date.now() - sttStarted

  // OpenRouter is intentionally optional and lives after STT. Speech
  // providers should never know whether the caller intends to polish,
  // because raw transcript quality and LLM editing are separate
  // concerns with separate keys, costs, and failure modes.
  if (!options.polish) {
    return {
      transcript,
      text: transcript.text,
      timing: {
        sttMs,
        totalMs: Date.now() - started,
      },
    }
  }

  const polishStarted = Date.now()
  const polished = await polishTranscriptWithOpenRouter({
    apiKey: options.polish.openRouterApiKey,
    rawTranscript: transcript.text,
    recentContext: options.recentContext,
    model: options.polish.model,
    baseUrl: options.polish.baseUrl,
    appTitle: options.polish.appTitle,
    appReferer: options.polish.appReferer,
    signal: options.signal,
  })
  const polishMs = Date.now() - polishStarted

  return {
    transcript,
    polished,
    text: polished.text || transcript.text,
    timing: {
      sttMs,
      polishMs,
      totalMs: Date.now() - started,
    },
  }
}
