import { transcribeAssemblyAi } from 'agent-voice-dictation'
import type { SpeechProviderRuntime } from './types.js'

export const assemblyAiProvider: SpeechProviderRuntime = {
  id: 'assemblyai',
  secretId: 'stt.assemblyai',
  transcribe(input) {
    return transcribeAssemblyAi({}, {
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
