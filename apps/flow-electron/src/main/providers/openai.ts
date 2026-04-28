import { transcribeOpenAi } from 'agent-voice-dictation'
import type { SpeechProviderRuntime } from './types.js'

export const openAiProvider: SpeechProviderRuntime = {
  id: 'openai',
  secretId: 'stt.openai',
  transcribe(input) {
    return transcribeOpenAi({}, {
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
