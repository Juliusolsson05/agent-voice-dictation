import { assemblyAiProvider } from './assemblyai.js'
import { deepgramProvider } from './deepgram.js'
import { elevenLabsProvider } from './elevenlabs.js'
import { gladiaProvider } from './gladia.js'
import { openAiProvider } from './openai.js'
import type { SpeechProviderRuntime } from './types.js'
import type { SttProviderId } from '@main/services/settingsStore.js'

const providers: Record<SttProviderId, SpeechProviderRuntime> = {
  assemblyai: assemblyAiProvider,
  deepgram: deepgramProvider,
  openai: openAiProvider,
  gladia: gladiaProvider,
  elevenlabs: elevenLabsProvider,
}

export function getSpeechProvider(id: SttProviderId): SpeechProviderRuntime {
  return providers[id]
}
