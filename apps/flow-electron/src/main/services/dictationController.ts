import { clipboard } from 'electron'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import {
  isSpeechProviderSelectable,
  polishTranscriptWithOpenRouter,
  wrapWithSttTag,
  type SpeechTraceEvent,
} from 'agent-voice-dictation'

import { getSpeechProvider } from '@main/providers/registry.js'
import type { SpeechProviderRuntime } from '@main/providers/types.js'
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
//   - provider dispatch through the provider registry
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

const DEEPSEEK_POLISH_TEMPORARILY_DISABLED = true

// The streaming provider owns its own WebSocket/session lifecycle, but the
// renderer only passes us an opaque session id after start. This tiny map is
// the controller's routing table back to the provider that created that id. It
// keeps Deepgram-specific state out of the controller while still making future
// streaming providers straightforward: register the session id with whichever
// provider started it, then route push/stop/cancel through the same interface.
const activeStreamingProviders = new Map<string, SttProviderId>()

async function getProviderApiKey(provider: SpeechProviderRuntime): Promise<string> {
  if (!isSpeechProviderSelectable(provider.id)) {
    throw new Error(`Provider "${provider.id}" is not available yet`)
  }
  const apiKey = await getSecret(provider.secretId)
    ?? await getSttApiKeyFromEnv(provider.id)
  if (!apiKey) {
    throw new Error(`No API key configured for provider "${provider.id}"`)
  }
  return apiKey
}

export async function startStreamingDictation(mimeType?: string): Promise<{ id: string }> {
  const settings = await loadSettings()
  const provider = getSpeechProvider(settings.sttProvider)
  if (!provider.streaming) {
    throw new Error(`Provider "${provider.id}" does not support streaming dictation`)
  }
  const apiKey = await getProviderApiKey(provider)
  const session = provider.streaming.start({
    apiKey,
    ...(mimeType ? { mimeType } : {}),
    onTrace: event => logDictationTrace(event.phase, event.details),
  })
  activeStreamingProviders.set(session.id, provider.id)
  return session
}

export function pushStreamingDictationChunk(id: string, chunk: ArrayBuffer): void {
  const provider = getActiveStreamingProvider(id, { required: false })
  if (!provider) return
  provider.streaming?.pushChunk(id, chunk)
}

export async function stopStreamingDictation(id: string): Promise<DictationOutcome> {
  const settings = await loadSettings()
  const provider = getActiveStreamingProvider(id)
  if (!provider) throw new Error(`No active streaming dictation session "${id}"`)
  let transcript
  try {
    transcript = await provider.streaming?.stop(id)
  } finally {
    activeStreamingProviders.delete(id)
  }
  if (!transcript) throw new Error(`Provider "${provider.id}" does not support streaming dictation`)
  return finalizeDictationText({
    id: transcript.id,
    startedAt: transcript.startedAt,
    raw: transcript.raw,
    provider: transcript.provider,
    model: transcript.model,
    sttDoneAt: transcript.sttDoneAt,
    audioDurationMs: transcript.audioDurationMs,
    settings,
  })
}

export function cancelStreamingDictation(id: string): void {
  const provider = getActiveStreamingProvider(id, { required: false })
  if (!provider) return
  provider.streaming?.cancel(id)
  activeStreamingProviders.delete(id)
}

function getActiveStreamingProvider(
  id: string,
  { required = true }: { required?: boolean } = {},
): SpeechProviderRuntime | null {
  const providerId = activeStreamingProviders.get(id)
  if (!providerId) {
    if (required) throw new Error(`No active streaming dictation session "${id}"`)
    return null
  }
  const provider = getSpeechProvider(providerId)
  if (!provider.streaming) {
    activeStreamingProviders.delete(id)
    throw new Error(`Provider "${provider.id}" does not support streaming dictation`)
  }
  return provider
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
  const provider = getSpeechProvider(settings.sttProvider)
  const apiKey = await getProviderApiKey(provider)

  const transcript = await provider.transcribe({
    apiKey,
    audio: input.audio,
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    language: 'en',
    onTrace: event => logProviderTrace(runId, event),
  })
  const sttDoneAt = Date.now()
  logDictationTrace('stt:done', {
    runId,
    provider: provider.id,
    sttMs: sttDoneAt - startedAt,
    transcriptChars: transcript.text.length,
    transcriptLanguage: transcript.language ?? null,
    audioDurationMs: transcript.durationMs ?? null,
  })
  if (!transcript.text.trim()) {
    throw new Error('No speech detected')
  }

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

  const finalText = formatComposerText(polish.polished ?? transcript.text, settings)
  logDictationTrace('transcript:final', {
    runId,
    rawChars: transcript.text.length,
    finalChars: finalText.length,
    raw: transcript.text,
    finalText,
  })

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
    provider: provider.id,
    model: polish.model,
    durationMs: polishDoneAt - startedAt,
    audioDurationMs: transcript.durationMs ?? null,
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
  audioDurationMs,
  settings,
}: {
  id: string
  startedAt: number
  raw: string
  provider: SttProviderId
  model: string | null
  sttDoneAt: number
  audioDurationMs?: number | null
  settings: AppSettings
}): Promise<DictationOutcome> {
  if (!raw.trim()) {
    throw new Error('No speech detected')
  }

  const polish = await maybePolish(raw, settings)
  const polishDoneAt = Date.now()
  const finalText = formatComposerText(polish.polished ?? raw, settings)
  logDictationTrace('transcript:final', {
    runId: id,
    rawChars: raw.length,
    finalChars: finalText.length,
    raw,
    finalText,
  })

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
    audioDurationMs: audioDurationMs ?? null,
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

function formatComposerText(text: string, settings: AppSettings): string {
  if (!settings.insertSttTag) return text

  // The wrapper is applied at the final composer boundary — never inside
  // provider clients or polish. The downstream LLM reading the message has
  // more context than our STT does, so flagging the text as speech-derived
  // lets it account for homophones, name spellings, and code-identifier
  // errors. Formatter lives in the package (composer/sttTag) so cc-shell
  // and any future host produce the same exact wrapper string — drift
  // would defeat any downstream model scanning for the marker.
  return wrapWithSttTag(text)
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
