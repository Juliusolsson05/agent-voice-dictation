import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'

export type DeepgramStreamingTrace = {
  phase: string
  details: Record<string, unknown>
}

export type DeepgramStreamingOutcome = {
  id: string
  startedAt: number
  raw: string
  model: string
  sttDoneAt: number
  chunkCount: number
  audioBytes: number
}

type DeepgramStreamingSession = {
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
  resolve: (outcome: DeepgramStreamingOutcome) => void
  reject: (err: Error) => void
  done: Promise<DeepgramStreamingOutcome>
  onTrace: (event: DeepgramStreamingTrace) => void
}

const DEEPGRAM_STREAM_MODEL = 'flux-general-en'
const DEEPGRAM_CLOSE_GRACE_MS = 140
const sessions = new Map<string, DeepgramStreamingSession>()
const failedSessions = new Map<string, Error>()

export function startDeepgramStreamingSession({
  apiKey,
  mimeType,
  onTrace,
}: {
  apiKey: string
  mimeType?: string
  onTrace: (event: DeepgramStreamingTrace) => void
}): { id: string } {
  const id = randomUUID()
  const startedAt = Date.now()
  const url = new URL('wss://api.deepgram.com/v2/listen')
  url.searchParams.set('model', DEEPGRAM_STREAM_MODEL)

  // Flux streaming is intentionally isolated from the generic dictation
  // controller. Batch providers share the package `transcribe*` clients; the
  // desktop's real-time provider is a stateful WebSocket with chunk ordering,
  // CloseStream behavior, and final-turn fallback rules. Keeping that state here
  // prevents Deepgram streaming concerns from leaking into the provider router.
  const ws = new WebSocket(url, {
    headers: {
      Authorization: `Token ${apiKey}`,
    },
  })

  let resolveDone!: (outcome: DeepgramStreamingOutcome) => void
  let rejectDone!: (err: Error) => void
  const session: DeepgramStreamingSession = {
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
    done: new Promise<DeepgramStreamingOutcome>((resolve, reject) => {
      resolveDone = resolve
      rejectDone = reject
    }),
    onTrace,
  }
  void session.done.catch(() => {})
  sessions.set(id, session)

  trace(session, 'stream:start', {
    runId: id,
    provider: 'deepgram',
    model: DEEPGRAM_STREAM_MODEL,
    mimeType: mimeType ?? null,
  })

  ws.on('open', () => {
    session.opened = true
    trace(session, 'deepgram:open', {
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
    trace(session, 'deepgram:error', {
      runId: id,
      message: err.message,
    })
    rejectSession(session, err)
  })

  ws.on('unexpected-response', (_request, response) => {
    const chunks: Buffer[] = []
    response.on('data', chunk => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    response.on('end', () => {
      trace(session, 'deepgram:handshake-rejected', {
        runId: id,
        statusCode: response.statusCode,
        statusMessage: response.statusMessage,
        body: Buffer.concat(chunks).toString('utf8'),
      })
    })
  })

  ws.on('close', (code, reason) => {
    trace(session, 'deepgram:close', {
      runId: id,
      ms: Date.now() - startedAt,
      code,
      reason: reason.toString(),
      finalChars: session.finalTexts.join(' ').trim().length,
      interimChars: session.interimText.trim().length,
    })
    if (session.stopped) {
      finalizeSession(session)
    }
  })

  return { id }
}

export function pushDeepgramStreamingChunk(id: string, chunk: ArrayBuffer): void {
  const session = sessions.get(id)
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

export async function stopDeepgramStreamingSession(id: string): Promise<DeepgramStreamingOutcome> {
  const failed = failedSessions.get(id)
  if (failed) {
    failedSessions.delete(id)
    throw failed
  }
  const session = sessions.get(id)
  if (!session) throw new Error(`No active Deepgram streaming session "${id}"`)
  if (session.stopped) return session.done
  session.stopped = true

  trace(session, 'stream:stop', {
    runId: id,
    chunkCount: session.chunkCount,
    audioBytes: session.audioBytes,
    ms: Date.now() - session.startedAt,
    closeGraceMs: DEEPGRAM_CLOSE_GRACE_MS,
  })

  await sleep(DEEPGRAM_CLOSE_GRACE_MS)

  if (session.ws.readyState === WebSocket.OPEN) {
    // `CloseStream` is the provider-specific finalization point. Closing the
    // socket directly can drop the last turn, especially when the user releases
    // the hotkey immediately after speaking.
    session.ws.send(JSON.stringify({ type: 'CloseStream' }))
  } else if (session.ws.readyState === WebSocket.CONNECTING) {
    session.ws.once('open', () => {
      session.ws.send(JSON.stringify({ type: 'CloseStream' }))
    })
  } else {
    finalizeSession(session)
  }

  return session.done
}

export function cancelDeepgramStreamingSession(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  sessions.delete(id)
  session.stopped = true
  try {
    session.ws.close()
  } catch {
    /* noop */
  }
}

export const deepgramStreamingModel = DEEPGRAM_STREAM_MODEL

function handleDeepgramMessage(session: DeepgramStreamingSession, data: WebSocket.RawData): void {
  const raw = data.toString()
  let message: Record<string, unknown>
  try {
    message = JSON.parse(raw) as Record<string, unknown>
  } catch {
    trace(session, 'deepgram:message:raw', {
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
    trace(session, 'deepgram:message', {
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

function finalizeSession(session: DeepgramStreamingSession): void {
  if (!sessions.has(session.id)) return
  sessions.delete(session.id)

  const raw = session.finalTexts.join(' ').replace(/\s+/g, ' ').trim()
    || session.interimText.trim()
  const sttDoneAt = Date.now()

  trace(session, 'deepgram:complete', {
    runId: session.id,
    sttMs: sttDoneAt - session.startedAt,
    chunkCount: session.chunkCount,
    audioBytes: session.audioBytes,
    textChars: raw.length,
    usedInterimFallback: !session.finalTexts.length && Boolean(session.interimText.trim()),
  })

  session.resolve({
    id: session.id,
    startedAt: session.startedAt,
    raw,
    model: DEEPGRAM_STREAM_MODEL,
    sttDoneAt,
    chunkCount: session.chunkCount,
    audioBytes: session.audioBytes,
  })
}

function rejectSession(session: DeepgramStreamingSession, err: unknown): void {
  sessions.delete(session.id)
  const error = err instanceof Error ? err : new Error(String(err))
  failedSessions.set(session.id, error)
  session.reject(error)
}

function trace(session: DeepgramStreamingSession, phase: string, details: Record<string, unknown>): void {
  session.onTrace({ phase, details })
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
