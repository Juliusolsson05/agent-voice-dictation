import { clipboard } from 'electron'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import {
  transcribeAssemblyAi,
  transcribeDeepgram,
  transcribeOpenAi,
  transcribeGladia,
  transcribeElevenLabs,
  type SpeechTranscript,
} from 'agent-voice-dictation'
import { polishTranscriptWithOpenRouter } from 'agent-voice-dictation'

import { getSecret } from '@main/secrets/safeStorageStore.js'
import {
  getOpenRouterApiKeyFromEnv,
  getSttApiKeyFromEnv,
} from '@main/services/envKeys.js'
import { loadSettings, type AppSettings, type SttProviderId } from '@main/services/settingsStore.js'
import { appendRecent, type DictationRecord } from '@main/services/recentsStore.js'

// DictationController is the orchestrator that turns "here is an
// audio buffer the renderer just recorded" into a finalized,
// optionally polished, optionally pasted result. It owns:
//
//   - secret resolution (look up the right key for the active provider)
//   - provider dispatch (one switch on settings.sttProvider)
//   - optional LLM polish via OpenRouter
//   - clipboard write + simulated paste at the OS cursor
//   - persistence into the recents log
//
// Crucially, it runs in main, not the renderer. The renderer never
// sees the user's API keys — it only ships an opaque audio Buffer
// and waits for the IPC reply with the final text. That is how the
// secret-store contract stays meaningful: keys never cross the
// renderer boundary.

export type DictationInput = {
  audio: ArrayBuffer
  mimeType?: string
}

export type DictationOutcome = {
  record: DictationRecord
  pasted: boolean
}

const SECRET_IDS: Record<SttProviderId, string> = {
  assemblyai: 'stt.assemblyai',
  deepgram: 'stt.deepgram',
  openai: 'stt.openai',
  gladia: 'stt.gladia',
  elevenlabs: 'stt.elevenlabs',
}

export async function transcribeForProvider(
  provider: SttProviderId,
  apiKey: string,
  audio: ArrayBuffer,
  mimeType: string | undefined,
  language: string | null,
): Promise<SpeechTranscript> {
  // Each provider has its own client because their request shapes
  // are not standardized. The `agent-voice-dictation` package
  // normalizes the responses to a single SpeechTranscript shape.
  // The package's TranscribeOptions wraps the raw bytes in
  // { data, mimeType, filename } so providers can pick the right
  // upload strategy (multipart vs raw body) without leaking that
  // decision into our caller.
  const baseOpts = {
    apiKey,
    audio: {
      data: audio,
      ...(mimeType ? { mimeType } : {}),
    },
    ...(language ? { language } : {}),
  }
  switch (provider) {
    case 'assemblyai':
      return transcribeAssemblyAi({}, baseOpts)
    case 'deepgram':
      return transcribeDeepgram({}, baseOpts)
    case 'openai':
      return transcribeOpenAi({}, baseOpts)
    case 'gladia':
      return transcribeGladia({}, baseOpts)
    case 'elevenlabs':
      return transcribeElevenLabs({}, baseOpts)
  }
}

async function maybePolish(
  raw: string,
  settings: AppSettings,
): Promise<{ polished: string | null; model: string | null }> {
  if (!settings.polishEnabled) return { polished: null, model: null }
  const apiKey = await getSecret('openrouter') ?? await getOpenRouterApiKeyFromEnv()
  if (!apiKey) {
    // Polish is optional. Missing key is not a failure — the user
    // gets the raw transcript anyway. The Settings UI surfaces the
    // configured/missing state so this isn't a silent surprise.
    return { polished: null, model: null }
  }
  try {
    const result = await polishTranscriptWithOpenRouter({
      apiKey,
      rawTranscript: raw,
      model: settings.openrouterModel,
    })
    return { polished: result.text, model: result.model }
  } catch (err) {
    // We deliberately swallow polish errors and fall back to raw —
    // the speech result is the irreplaceable artifact; the polish is
    // a nice-to-have.
    // eslint-disable-next-line no-console
    console.warn('[dictation] polish failed; falling back to raw:', err)
    return { polished: null, model: null }
  }
}

function pasteAtCursor(): Promise<void> {
  // Auto-paste implementation. We rely on the OS to actually move the
  // text from the clipboard into the focused app:
  //   - macOS: AppleScript "tell application System Events to keystroke v using command down"
  //   - Linux/Windows: not implemented in v1; the user can ⌘V manually
  //
  // Why osascript and not robotjs/iohook: native deps complicate
  // packaging across architectures and Electron versions. osascript
  // is built into macOS and is good enough for v1.
  return new Promise(resolve => {
    if (process.platform !== 'darwin') return resolve()
    execFile(
      'osascript',
      [
        '-e',
        'tell application "System Events" to keystroke "v" using command down',
      ],
      err => {
        if (err) {
          // eslint-disable-next-line no-console
          console.warn('[dictation] osascript paste failed:', err)
        }
        resolve()
      },
    )
  })
}

export async function runDictation(input: DictationInput): Promise<DictationOutcome> {
  const startedAt = Date.now()
  const settings = await loadSettings()
  const apiKey = await getSecret(SECRET_IDS[settings.sttProvider])
    ?? await getSttApiKeyFromEnv(settings.sttProvider)
  if (!apiKey) {
    throw new Error(`No API key configured for provider "${settings.sttProvider}"`)
  }

  const transcript = await transcribeForProvider(
    settings.sttProvider,
    apiKey,
    input.audio,
    input.mimeType,
    settings.language,
  )
  const sttDoneAt = Date.now()

  const polish = await maybePolish(transcript.text, settings)
  const polishDoneAt = Date.now()

  const finalText = polish.polished ?? transcript.text

  // Clipboard write happens BEFORE the optional paste keystroke so
  // that even if the keystroke fails (no accessibility permission,
  // wrong focused app), the text is still on the clipboard for a
  // manual ⌘V.
  clipboard.writeText(finalText)
  let pasted = false
  if (settings.autoPasteAtCursor) {
    await pasteAtCursor()
    pasted = process.platform === 'darwin'
  }

  const record: DictationRecord = {
    id: randomUUID(),
    ts: startedAt,
    raw: transcript.text,
    polished: polish.polished,
    provider: settings.sttProvider,
    model: polish.model,
    durationMs: polishDoneAt - startedAt,
  }
  await appendRecent(record)

  // sttDoneAt is computed but not currently surfaced — keeping it
  // around so a future Insights panel (NOT in v1) can break out
  // STT vs polish latency without re-instrumenting.
  void sttDoneAt
  return { record, pasted }
}
