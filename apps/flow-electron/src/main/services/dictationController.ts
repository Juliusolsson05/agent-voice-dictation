import { clipboard } from 'electron'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import {
  transcribeAssemblyAi,
  transcribeDeepgram,
  transcribeOpenAi,
  transcribeGladia,
  transcribeElevenLabs,
  type SpeechTraceEvent,
  type SpeechTranscript,
} from 'agent-voice-dictation'
import { polishTranscriptWithOpenRouter } from 'agent-voice-dictation'

import { getSecret } from '@main/secrets/safeStorageStore.js'
import {
  getOpenRouterApiKeyFromEnv,
  getSttApiKeyFromEnv,
} from '@main/services/envKeys.js'
import {
  cancelDeepgramStreamingSession,
  deepgramStreamingModel,
  pushDeepgramStreamingChunk,
  startDeepgramStreamingSession,
  stopDeepgramStreamingSession,
} from '@main/services/deepgramStreaming.js'
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

const DEEPSEEK_POLISH_TEMPORARILY_DISABLED = true

export async function transcribeForProvider(
  provider: SttProviderId,
  apiKey: string,
  audio: ArrayBuffer,
  mimeType: string | undefined,
  language: string,
  onTrace: (event: SpeechTraceEvent) => void,
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
    language,
    onTrace,
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

export async function startStreamingDictation(mimeType?: string): Promise<{ id: string }> {
  const apiKey = await getSecret(SECRET_IDS.deepgram)
    ?? await getSttApiKeyFromEnv('deepgram')
  if (!apiKey) {
    throw new Error('No API key configured for provider "deepgram"')
  }
  return startDeepgramStreamingSession({
    apiKey,
    ...(mimeType ? { mimeType } : {}),
    onTrace: event => logDictationTrace(event.phase, event.details),
  })
}

export function pushStreamingDictationChunk(id: string, chunk: ArrayBuffer): void {
  pushDeepgramStreamingChunk(id, chunk)
}

export async function stopStreamingDictation(id: string): Promise<DictationOutcome> {
  const settings = await loadSettings()
  const transcript = await stopDeepgramStreamingSession(id)
  return finalizeDictationText({
    id: transcript.id,
    startedAt: transcript.startedAt,
    raw: transcript.raw,
    provider: 'deepgram',
    model: deepgramStreamingModel,
    sttDoneAt: transcript.sttDoneAt,
    settings,
  })
}

export function cancelStreamingDictation(id: string): void {
  cancelDeepgramStreamingSession(id)
}

async function maybePolish(
  raw: string,
  settings: AppSettings,
): Promise<{ polished: string | null; model: string | null }> {
  if (DEEPSEEK_POLISH_TEMPORARILY_DISABLED) {
    // This is an intentional diagnostic bypass, not a product decision. The
    // dictation loop currently has two network phases: STT and OpenRouter
    // cleanup. Disabling the cleanup even when an older settings file still has
    // `polishEnabled: true` lets us measure whether the perceived slowness is
    // DeepSeek/OpenRouter or AssemblyAI's batch upload/job/poll path.
    // Re-enable by removing this guard once the latency source is clear.
    void raw
    void settings
    return { polished: null, model: null }
  }
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
  const runId = randomUUID()
  const startedAt = Date.now()
  logDictationTrace('start', {
    runId,
    audioBytes: input.audio.byteLength,
    mimeType: input.mimeType ?? null,
  })
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
    'en',
    event => logProviderTrace(runId, event),
  )
  const sttDoneAt = Date.now()
  logDictationTrace('stt:done', {
    runId,
    provider: settings.sttProvider,
    sttMs: sttDoneAt - startedAt,
    transcriptChars: transcript.text.length,
    transcriptLanguage: transcript.language ?? null,
    audioDurationMs: transcript.durationMs ?? null,
  })

  const polish = await maybePolish(transcript.text, settings)
  const polishDoneAt = Date.now()
  logDictationTrace('polish:done', {
    runId,
    polishMs: polishDoneAt - sttDoneAt,
    polishEnabled: settings.polishEnabled,
    polishBypassed: DEEPSEEK_POLISH_TEMPORARILY_DISABLED,
    model: polish.model,
    polishedChars: polish.polished?.length ?? 0,
  })

  const finalText = polish.polished ?? transcript.text

  // Clipboard write happens BEFORE the optional paste keystroke so
  // that even if the keystroke fails (no accessibility permission,
  // wrong focused app), the text is still on the clipboard for a
  // manual ⌘V.
  clipboard.writeText(finalText)
  const pasteStartedAt = Date.now()
  let pasted = false
  if (settings.autoPasteAtCursor) {
    await pasteAtCursor()
    pasted = process.platform === 'darwin'
  }
  const pasteDoneAt = Date.now()

  const record: DictationRecord = {
    id: runId,
    ts: startedAt,
    raw: transcript.text,
    polished: polish.polished,
    provider: settings.sttProvider,
    model: polish.model,
    durationMs: polishDoneAt - startedAt,
  }
  await appendRecent(record)
  const doneAt = Date.now()
  logDictationTrace('done', {
    runId,
    totalMs: doneAt - startedAt,
    sttMs: sttDoneAt - startedAt,
    polishMs: polishDoneAt - sttDoneAt,
    pasteMs: pasteDoneAt - pasteStartedAt,
    persistMs: doneAt - pasteDoneAt,
    pasted,
    finalChars: finalText.length,
  })

  return { record, pasted }
}

async function finalizeDictationText({
  id,
  startedAt,
  raw,
  provider,
  model,
  sttDoneAt,
  settings,
}: {
  id: string
  startedAt: number
  raw: string
  provider: string
  model: string | null
  sttDoneAt: number
  settings: AppSettings
}): Promise<DictationOutcome> {
  const polish = await maybePolish(raw, settings)
  const polishDoneAt = Date.now()
  const finalText = polish.polished ?? raw

  logDictationTrace('polish:done', {
    runId: id,
    polishMs: polishDoneAt - sttDoneAt,
    polishEnabled: settings.polishEnabled,
    polishBypassed: DEEPSEEK_POLISH_TEMPORARILY_DISABLED,
    model: polish.model,
    polishedChars: polish.polished?.length ?? 0,
  })

  clipboard.writeText(finalText)
  const pasteStartedAt = Date.now()
  let pasted = false
  if (settings.autoPasteAtCursor) {
    await pasteAtCursor()
    pasted = process.platform === 'darwin'
  }
  const pasteDoneAt = Date.now()

  const record: DictationRecord = {
    id,
    ts: startedAt,
    raw,
    polished: polish.polished,
    provider,
    model: polish.model ?? model,
    durationMs: pasteDoneAt - startedAt,
  }
  await appendRecent(record)
  const doneAt = Date.now()

  logDictationTrace('done', {
    runId: id,
    totalMs: doneAt - startedAt,
    sttMs: sttDoneAt - startedAt,
    polishMs: polishDoneAt - sttDoneAt,
    pasteMs: pasteDoneAt - pasteStartedAt,
    persistMs: doneAt - pasteDoneAt,
    pasted,
    finalChars: finalText.length,
  })

  return { record, pasted }
}

function logProviderTrace(runId: string, event: SpeechTraceEvent): void {
  logDictationTrace(`${event.provider}:${event.phase}`, {
    runId,
    ...withoutProviderPhase(event),
  })
}

function withoutProviderPhase(event: SpeechTraceEvent): Record<string, unknown> {
  const { provider: _provider, phase: _phase, ...rest } = event
  return rest
}

function logDictationTrace(phase: string, details: Record<string, unknown>): void {
  // Keep this as one JSON-ish line per phase so terminal logs from `npm start`
  // can be grepped, copied into issues, or compared between providers. These
  // logs intentionally live in main, not the renderer, because renderer console
  // output gets mixed with DevTools noise and does not reliably show provider
  // timings from the package clients.
  // eslint-disable-next-line no-console
  console.log(`[dictation:trace] ${phase}`, details)
}
