import {
  createDeepgramStreamingProvider,
  transcribeDeepgram,
} from 'agent-voice-dictation'

import type { SpeechProviderRuntime } from './types.js'

const deepgramStreaming = createDeepgramStreamingProvider()

export const deepgramProvider: SpeechProviderRuntime = {
  id: 'deepgram',
  secretId: 'stt.deepgram',
  transcribe(input) {
    return transcribeDeepgram({}, {
      apiKey: input.apiKey,
      audio: {
        data: input.audio,
        ...(input.mimeType ? { mimeType: input.mimeType } : {}),
      },
      language: input.language,
      onTrace: input.onTrace,
    })
  },
  streaming: {
    // The Electron app deliberately does not own Deepgram's WebSocket protocol.
    // It only adapts app-level concerns (secret ids, recents, paste behavior)
    // onto the package-owned streaming provider. Agent Code can now consume the
    // same implementation without importing anything from this desktop app.
    start(input) {
      return deepgramStreaming.start({
        apiKey: input.apiKey,
        ...(input.mimeType ? { mimeType: input.mimeType } : {}),
        onTrace: event => input.onTrace({
          phase: event.phase,
          details: event as unknown as Record<string, unknown>,
        }),
      })
    },
    pushChunk(id, chunk) {
      deepgramStreaming.pushChunk(id, chunk)
    },
    async stop(id) {
      const result = await deepgramStreaming.stop(id)
      return {
        id: result.id,
        startedAt: result.startedAt,
        raw: result.text,
        provider: 'deepgram',
        model: result.model,
        sttDoneAt: result.sttDoneAt,
        audioDurationMs: result.sttDoneAt - result.startedAt,
      }
    },
    cancel(id) {
      deepgramStreaming.cancel(id)
    },
  },
}
