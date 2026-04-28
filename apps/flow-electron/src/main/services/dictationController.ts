import { clipboard } from 'electron'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'

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
const DEEPGRAM_STREAM_MODEL = 'flux-general-en'
const streamingSessions = new Map<string, StreamingSession>()
const failedStreamingSessions = new Map<string, Error>()

type StreamingSession = {
  id: string
  startedAt: number
  mimeType: string | undefined
  ws: WebSocket
  opened: boolean
  stopped: boolean
  queuedChunks: Buffer[]
  chunkCount: number
  audioBytes: number
  finalTexts: string[]
  interimText: string
  resolve: (outcome: DictationOutcome) => void
  reject: (err: Error) => void
  done: Promise<DictationOutcome>
}

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
  const id = randomUUID()
  const startedAt = Date.now()
  const settings = await loadSettings()
  const apiKey = await getSecret(SECRET_IDS.deepgram)
    ?? await getSttApiKeyFromEnv('deepgram')
  if (!apiKey) {
    throw new Error('No API key configured for provider "deepgram"')
  }

  const url = new URL('wss://api.deepgram.com/v2/listen')
  url.searchParams.set('model', DEEPGRAM_STREAM_MODEL)

  // Flux is the streaming provider path for the Electron app. The old
  // MediaRecorder blob upload path cannot hit sub-second latency because upload
  // + job creation already exceeds the budget. We keep the WebSocket in main so
  // the Deepgram key never crosses into the renderer; the renderer only streams
  // opaque audio chunks over IPC.
  const ws = new WebSocket(url, {
    headers: {
      Authorization: `Token ${apiKey}`,
    },
  })

  let resolveDone!: (outcome: DictationOutcome) => void
  let rejectDone!: (err: Error) => void
  const session: StreamingSession = {
    id,
    startedAt,
    mimeType,
    ws,
    opened: false,
    stopped: false,
    queuedChunks: [],
    chunkCount: 0,
    audioBytes: 0,
    finalTexts: [],
    interimText: '',
    resolve: outcome => resolveDone(outcome),
    reject: err => rejectDone(err),
    done: new Promise<DictationOutcome>((resolve, reject) => {
      resolveDone = resolve
      rejectDone = reject
    }),
  }
  // A WebSocket can fail before the renderer sends stop. Without a local catch,
  // Node reports an unhandled rejection even though the UI will later await
  // `streamStop`. We still rethrow the stored error from streamStop; this line
  // only prevents noisy process-level warnings.
  void session.done.catch(() => {})
  streamingSessions.set(id, session)

  logDictationTrace('stream:start', {
    runId: id,
    provider: 'deepgram',
    model: DEEPGRAM_STREAM_MODEL,
    mimeType: mimeType ?? null,
  })

  ws.on('open', () => {
    session.opened = true
    logDictationTrace('deepgram:open', {
      runId: id,
      ms: Date.now() - startedAt,
      queuedChunks: session.queuedChunks.length,
    })
    for (const chunk of session.queuedChunks.splice(0)) {
      ws.send(chunk)
    }
  })

  ws.on('message', data => {
    handleDeepgramMessage(session, data)
  })

  ws.on('error', err => {
    logDictationTrace('deepgram:error', {
      runId: id,
      message: err.message,
    })
    rejectStreamingSession(session, err)
  })

  ws.on('unexpected-response', (_request, response) => {
    const chunks: Buffer[] = []
    response.on('data', chunk => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    response.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      logDictationTrace('deepgram:handshake-rejected', {
        runId: id,
        statusCode: response.statusCode,
        statusMessage: response.statusMessage,
        body,
      })
    })
  })

  ws.on('close', (code, reason) => {
    logDictationTrace('deepgram:close', {
      runId: id,
      ms: Date.now() - startedAt,
      code,
      reason: reason.toString(),
      finalChars: session.finalTexts.join(' ').trim().length,
      interimChars: session.interimText.trim().length,
    })
    if (session.stopped) {
      void finalizeStreamingSession(session, settings)
    }
  })

  return { id }
}

export function pushStreamingDictationChunk(id: string, chunk: ArrayBuffer): void {
  const session = streamingSessions.get(id)
  if (!session || session.stopped) return
  const buffer = Buffer.from(chunk)
  if (!buffer.length) return

  session.chunkCount += 1
  session.audioBytes += buffer.byteLength

  if (session.opened && session.ws.readyState === WebSocket.OPEN) {
    session.ws.send(buffer)
  } else {
    session.queuedChunks.push(buffer)
  }
}

export async function stopStreamingDictation(id: string): Promise<DictationOutcome> {
  const failed = failedStreamingSessions.get(id)
  if (failed) {
    failedStreamingSessions.delete(id)
    throw failed
  }
  const session = streamingSessions.get(id)
  if (!session) throw new Error(`No active streaming dictation session "${id}"`)
  if (session.stopped) return session.done
  session.stopped = true

  logDictationTrace('stream:stop', {
    runId: id,
    chunkCount: session.chunkCount,
    audioBytes: session.audioBytes,
    ms: Date.now() - session.startedAt,
  })

  if (session.ws.readyState === WebSocket.OPEN) {
    // Deepgram's WebSocket API supports a CloseStream control message to flush
    // final transcripts. Closing the socket without it can drop the last turn,
    // which is exactly the text a dictation user cares about most.
    session.ws.send(JSON.stringify({ type: 'CloseStream' }))
  } else if (session.ws.readyState === WebSocket.CONNECTING) {
    session.ws.once('open', () => {
      session.ws.send(JSON.stringify({ type: 'CloseStream' }))
    })
  } else {
    void finalizeStreamingSession(session, await loadSettings())
  }

  return session.done
}

export function cancelStreamingDictation(id: string): void {
  const session = streamingSessions.get(id)
  if (!session) return
  streamingSessions.delete(id)
  session.stopped = true
  try {
    session.ws.close()
  } catch {
    /* noop */
  }
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

function handleDeepgramMessage(session: StreamingSession, data: WebSocket.RawData): void {
  const raw = data.toString()
  let message: Record<string, unknown>
  try {
    message = JSON.parse(raw) as Record<string, unknown>
  } catch {
    logDictationTrace('deepgram:message:raw', {
      runId: session.id,
      bytes: raw.length,
    })
    return
  }

  const transcript = extractDeepgramTranscript(message)
  const event = typeof message.event === 'string' ? message.event : null
  const isFinal = message.is_final === true
    || message.speech_final === true
    || event === 'EndOfTurn'
  const type = typeof message.type === 'string' ? message.type : null

  if (transcript) {
    if (isFinal) {
      session.finalTexts.push(transcript)
    } else {
      session.interimText = transcript
    }
  }

  if (transcript || type) {
    logDictationTrace('deepgram:message', {
      runId: session.id,
      type,
      event,
      isFinal,
      transcriptChars: transcript.length,
      elapsedMs: Date.now() - session.startedAt,
    })
  }
}

function extractDeepgramTranscript(message: Record<string, unknown>): string {
  if (typeof message.transcript === 'string') return message.transcript.trim()
  const channel = message.channel as Record<string, unknown> | undefined
  const alternatives = channel?.alternatives as unknown[] | undefined
  const first = alternatives?.[0] as Record<string, unknown> | undefined
  return typeof first?.transcript === 'string' ? first.transcript.trim() : ''
}

async function finalizeStreamingSession(
  session: StreamingSession,
  settings: AppSettings,
): Promise<void> {
  if (!streamingSessions.has(session.id)) return
  streamingSessions.delete(session.id)

  try {
    const sttDoneAt = Date.now()
    const raw = session.finalTexts.join(' ').replace(/\s+/g, ' ').trim()
      || session.interimText.trim()

    logDictationTrace('deepgram:complete', {
      runId: session.id,
      sttMs: sttDoneAt - session.startedAt,
      chunkCount: session.chunkCount,
      audioBytes: session.audioBytes,
      textChars: raw.length,
      usedInterimFallback: !session.finalTexts.length && Boolean(session.interimText.trim()),
    })

    const polish = await maybePolish(raw, settings)
    const polishDoneAt = Date.now()
    const finalText = polish.polished ?? raw

    logDictationTrace('polish:done', {
      runId: session.id,
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
      id: session.id,
      ts: session.startedAt,
      raw,
      polished: polish.polished,
      provider: 'deepgram',
      model: DEEPGRAM_STREAM_MODEL,
      durationMs: pasteDoneAt - session.startedAt,
    }
    await appendRecent(record)
    const doneAt = Date.now()

    logDictationTrace('done', {
      runId: session.id,
      totalMs: doneAt - session.startedAt,
      sttMs: sttDoneAt - session.startedAt,
      polishMs: polishDoneAt - sttDoneAt,
      pasteMs: pasteDoneAt - pasteStartedAt,
      persistMs: doneAt - pasteDoneAt,
      pasted,
      finalChars: finalText.length,
    })

    session.resolve({ record, pasted })
  } catch (err) {
    rejectStreamingSession(session, err)
  }
}

function rejectStreamingSession(session: StreamingSession, err: unknown): void {
  streamingSessions.delete(session.id)
  const error = err instanceof Error ? err : new Error(String(err))
  failedStreamingSessions.set(session.id, error)
  session.reject(error)
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
