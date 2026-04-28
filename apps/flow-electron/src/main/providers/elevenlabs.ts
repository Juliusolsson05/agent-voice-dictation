import { transcribeElevenLabs } from 'agent-voice-dictation'
import type { SpeechProviderRuntime } from './types.js'

export const elevenLabsProvider: SpeechProviderRuntime = {
  id: 'elevenlabs',
  secretId: 'stt.elevenlabs',
  transcribe(input) {
    return transcribeElevenLabs({}, {
      apiKey: input.apiKey,
      audio: {
        data: input.audio,
        ...(input.mimeType ? { mimeType: input.mimeType } : {}),
      },
      language: input.language,
      onTrace: input.onTrace,
    })
  },
}
