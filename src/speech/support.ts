import type { SpeechProviderId } from './types.js'

export type SpeechProviderSupportStatus = 'available' | 'disabled-unverified'

export type SpeechProviderSupport = {
  id: SpeechProviderId
  label: string
  selectable: boolean
  status: SpeechProviderSupportStatus
  reason: string
}

export const STT_PROVIDER_SUPPORT = {
  assemblyai: {
    id: 'assemblyai',
    label: 'AssemblyAI',
    // Selectable in the package sense (the client is live-key validated by
    // the provider smoke test), but not selectable in the desktop app sense:
    // the Status renderer currently only drives the streaming IPC path, and
    // AssemblyAI does not implement streaming. Picking it from Settings used
    // to throw "Provider does not support streaming dictation" on every
    // hotkey press with no clear UX recovery. Re-enable once the renderer
    // either falls back to dictation:run for batch-only providers or we add
    // a streaming-capable AssemblyAI client.
    selectable: false,
    status: 'disabled-unverified',
    reason: 'Batch path is covered by live tests, but the desktop app currently only drives the streaming path. Pick Deepgram for now.',
  },
  deepgram: {
    id: 'deepgram',
    label: 'Deepgram',
    selectable: true,
    status: 'available',
    reason: 'Batch path is covered by live provider tests; streaming is the active low-latency path.',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    selectable: false,
    status: 'disabled-unverified',
    reason: 'Client exists, but this provider has not been validated with a real API key in the production flow.',
  },
  gladia: {
    id: 'gladia',
    label: 'Gladia',
    selectable: false,
    status: 'disabled-unverified',
    reason: 'Client exists, but this provider has not been validated with a real API key in the production flow.',
  },
  elevenlabs: {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    selectable: false,
    status: 'disabled-unverified',
    reason: 'Client exists, but this provider has not been validated with a real API key in the production flow.',
  },
} as const satisfies Record<SpeechProviderId, SpeechProviderSupport>

export type SpeechProviderSupportMap = typeof STT_PROVIDER_SUPPORT

export function isSpeechProviderSelectable(id: SpeechProviderId): boolean {
  // This is deliberately stricter than "does a client file exist".
  // We have code for all five providers because their APIs were documented up
  // front, but only AssemblyAI and Deepgram have been exercised against real
  // keys in our checked-in live provider suite. Shipping untested providers as
  // selectable creates fake confidence: a user can paste a key, select a
  // provider, and only discover at dictation time that our request shape or
  // model default is wrong. Keep unverified clients in the codebase so future
  // work can finish them, but gate product selection on live validation.
  return STT_PROVIDER_SUPPORT[id].selectable
}
