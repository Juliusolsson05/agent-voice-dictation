import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'

import type { SpeechTraceEvent } from '../types.js'

export type DeepgramStreamingOptions = {
  baseUrl?: string
  model?: string
  /** Milliseconds to wait between the user releasing the hotkey and us
   *  sending CloseStream. The original 140ms here was a defensive buffer
   *  for in-flight MediaRecorder chunks, but the renderer's onstop handler
   *  already awaits its own pending IPC sends before calling main.stop(),
   *  so by the time we get here the WebSocket buffer is fully populated.
   *  Default is now 0 — every saved millisecond is a millisecond Flux has
   *  to commit the final turn before our watchdog gives up. */
  closeGraceMs?: number
  /** Milliseconds to wait after CloseStream for Deepgram to send EndOfTurn
   *  before we force-close the socket and finalize with whatever interim
   *  text we have. Flux finalizes on its own state-machine schedule, not
   *  ours; for short turns the model often hasn't decided "done" by the
   *  time the user releases. 1500ms covers typical Flux finalization
   *  latency on short utterances and keeps the worst-case "transcribing…"
   *  pill duration short enough that the user does not think we hung. */
  endOfTurnWatchdogMs?: number
}

export type DeepgramStreamingStartInput = {
  apiKey: string
  mimeType?: string
  onTrace?: ((event: SpeechTraceEvent) => void) | undefined
  /** Optional host callback for live transcript previews. The streaming
   *  provider still owns Deepgram protocol and final-selection rules; host apps
   *  use this only for UI optimism while the socket is alive. */
  onTranscript?: ((event: DeepgramStreamingTranscriptEvent) => void) | undefined
}

export type DeepgramStreamingTranscriptEvent = {
  id: string
  text: string
  isFinal: boolean
  source: 'final' | 'interim'
}

export type DeepgramStreamingTranscript = {
  id: string
  startedAt: number
  text: string
  provider: 'deepgram'
  model: string
  sttDoneAt: number
  chunkCount: number
  audioBytes: number
}

export type DeepgramStreamingProvider = {
  start(input: DeepgramStreamingStartInput): { id: string }
  pushChunk(id: string, chunk: ArrayBuffer | Uint8Array): void
  stop(id: string): Promise<DeepgramStreamingTranscript>
  cancel(id: string): void
}

type DeepgramStreamingSession = {
  id: string
  startedAt: number
  ws: WebSocket
  opened: boolean
  stopped: boolean
  queuedChunks: Buffer[]
  chunkCount: number
  audioBytes: number
  wsSentChunks: number
  wsSentBytes: number
  finalTexts: string[]
  interimText: string
  resolve: (outcome: DeepgramStreamingTranscript) => void
  reject: (err: Error) => void
  done: Promise<DeepgramStreamingTranscript>
  onTrace: (event: SpeechTraceEvent) => void
  onTranscript: (event: DeepgramStreamingTranscriptEvent) => void
}

const DEFAULT_DEEPGRAM_STREAM_MODEL = 'flux-general-en'
const DEFAULT_CLOSE_GRACE_MS = 0
const DEFAULT_END_OF_TURN_WATCHDOG_MS = 1500

export function createDeepgramStreamingProvider(
  defaults: DeepgramStreamingOptions = {},
): DeepgramStreamingProvider {
  const model = defaults.model ?? DEFAULT_DEEPGRAM_STREAM_MODEL
  const closeGraceMs = defaults.closeGraceMs ?? DEFAULT_CLOSE_GRACE_MS
  const endOfTurnWatchdogMs = defaults.endOfTurnWatchdogMs ?? DEFAULT_END_OF_TURN_WATCHDOG_MS
  const sessions = new Map<string, DeepgramStreamingSession>()
  const failedSessions = new Map<string, Error>()

  function start({ apiKey, mimeType, onTrace, onTranscript }: DeepgramStreamingStartInput): { id: string } {
    const id = randomUUID()
    const startedAt = Date.now()
    const url = new URL(defaults.baseUrl ?? 'wss://api.deepgram.com/v2/listen')
    url.searchParams.set('model', model)
    // Deepgram streaming is package-owned because it is provider protocol, not
    // app behavior. The desktop app and Agent Code both need the same guarantees:
    // queue chunks until the socket opens, send Deepgram's CloseStream control
    // message instead of closing the socket directly, and keep the last interim
    // text as a fallback when the provider does not emit a final turn. If this
    // lived in an app adapter, every host would have to rediscover those edge
    // cases independently.
    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Token ${apiKey}`,
      },
    })

    let resolveDone!: (outcome: DeepgramStreamingTranscript) => void
    let rejectDone!: (err: Error) => void
    const session: DeepgramStreamingSession = {
      id,
      startedAt,
      ws,
      opened: false,
      stopped: false,
      queuedChunks: [],
      chunkCount: 0,
      audioBytes: 0,
      wsSentChunks: 0,
      wsSentBytes: 0,
      finalTexts: [],
      interimText: '',
      resolve: outcome => resolveDone(outcome),
      reject: err => rejectDone(err),
      done: new Promise<DeepgramStreamingTranscript>((resolve, reject) => {
        resolveDone = resolve
        rejectDone = reject
      }),
      onTrace: onTrace ?? (() => {}),
      onTranscript: onTranscript ?? (() => {}),
    }
    void session.done.catch(() => {})
    sessions.set(id, session)

    trace(session, 'stream:start', {
      runId: id,
      model,
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
        trace(session, 'deepgram:chunk:send', {
          runId: id,
          chunkIndex: session.wsSentChunks + 1,
          bytes: chunk.byteLength,
          queuedFlush: true,
          elapsedMs: Date.now() - startedAt,
        })
        session.wsSentChunks += 1
        session.wsSentBytes += chunk.byteLength
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
        const body = Buffer.concat(chunks).toString('utf8')
        trace(session, 'deepgram:handshake-rejected', {
          runId: id,
          statusCode: response.statusCode,
          statusMessage: response.statusMessage,
          body,
        })
        rejectSession(
          session,
          new Error(`Deepgram streaming handshake rejected (${response.statusCode ?? 'unknown'}): ${body || response.statusMessage || 'Bad response'}`),
        )
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

  function pushChunk(id: string, chunk: ArrayBuffer | Uint8Array): void {
    const session = sessions.get(id)
    if (!session || session.stopped) return
    const buffer = chunkToBuffer(chunk)
    if (!buffer.length) return

    session.chunkCount += 1
    session.audioBytes += buffer.byteLength

    if (session.opened && session.ws.readyState === WebSocket.OPEN) {
      trace(session, 'deepgram:chunk:send', {
        runId: id,
        chunkIndex: session.wsSentChunks + 1,
        bytes: buffer.byteLength,
        queuedFlush: false,
        elapsedMs: Date.now() - session.startedAt,
      })
      session.wsSentChunks += 1
      session.wsSentBytes += buffer.byteLength
      session.ws.send(buffer)
    } else {
      session.queuedChunks.push(buffer)
      trace(session, 'deepgram:chunk:queue', {
        runId: id,
        chunkIndex: session.chunkCount,
        bytes: buffer.byteLength,
        queuedChunks: session.queuedChunks.length,
        elapsedMs: Date.now() - session.startedAt,
      })
    }
  }

  async function stop(id: string): Promise<DeepgramStreamingTranscript> {
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
      closeGraceMs,
      endOfTurnWatchdogMs,
    })

    if (closeGraceMs > 0) await sleep(closeGraceMs)

    // CloseStream is Deepgram's protocol-level finalization for an active
    // stream — it tells the server "no more audio is coming, please emit
    // your final EndOfTurn so we don't lose the trailing phrase". When the
    // session has no audio at all, sending CloseStream as the first message
    // makes Deepgram's parser try to interpret the JSON text as raw audio
    // bytes and fail with UNPARSABLE_CLIENT_MESSAGE. A plain socket close
    // is the correct end-of-stream signal for an empty session: the server
    // tears down quietly and our finalizeSession resolves with empty text,
    // which the controller then surfaces as the normal "no speech detected"
    // path instead of a confusing provider error in the user's terminal.
    const finishWithProperClose = () => {
      if (session.wsSentChunks > 0) {
        session.ws.send(JSON.stringify({ type: 'CloseStream' }))
      } else {
        try {
          session.ws.close()
        } catch {
          /* noop */
        }
      }
    }

    if (session.ws.readyState === WebSocket.OPEN) {
      finishWithProperClose()
    } else if (session.ws.readyState === WebSocket.CONNECTING) {
      session.ws.once('open', finishWithProperClose)
    } else {
      finalizeSession(session)
      return session.done
    }

    // Watchdog. Flux's CloseStream contract says "the server will flush any
    // remaining responses and then close" but the docs do not promise a
    // bound on how long that takes, and traces show the server frequently
    // closing the socket without ever sending an EndOfTurn for short turns.
    // When that happens we fall back to the latest interim — which is the
    // model's incomplete guess and almost always missing the last word.
    //
    // Two-pronged fix: handleDeepgramMessage finalises early on EndOfTurn
    // (the fast path — usually fires within ~150ms of CloseStream), and
    // this watchdog catches the case where Flux never commits within
    // endOfTurnWatchdogMs. Force-closing triggers the close handler which
    // calls finalizeSession; finalizeSession is idempotent so the early
    // path beats it cleanly when both fire.
    setTimeout(() => {
      if (sessions.has(session.id) && session.ws.readyState === WebSocket.OPEN) {
        trace(session, 'deepgram:end-of-turn:watchdog', {
          runId: id,
          watchdogMs: endOfTurnWatchdogMs,
          finalChars: session.finalTexts.join(' ').trim().length,
          interimChars: session.interimText.trim().length,
        })
        try {
          session.ws.close()
        } catch {
          /* noop */
        }
      }
    }, endOfTurnWatchdogMs)

    return session.done
  }

  function cancel(id: string): void {
    // Cancel must drop both maps. failedSessions only gets cleared by stop()
    // reading the entry, but if the renderer cancels (X button, hotkey held
    // <180ms, audible-error reset) we never call stop, so any stored failure
    // would leak forever. Cancel is the user saying "I do not care about the
    // outcome" — drop the bookkeeping with the audio.
    failedSessions.delete(id)
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

    if (type === 'Error') {
      const messageText = typeof message.message === 'string'
        ? message.message
        : typeof message.description === 'string'
          ? message.description
          : 'Deepgram streaming error'
      trace(session, 'deepgram:error-message', {
        runId: session.id,
        message: messageText,
        raw: message,
      })
      rejectSession(session, new Error(messageText))
      try {
        session.ws.close()
      } catch {
        /* noop */
      }
      return
    }

    if (transcript) {
      if (isFinal) {
        session.finalTexts.push(transcript)
        session.onTranscript({
          id: session.id,
          text: session.finalTexts.join(' ').replace(/\s+/g, ' ').trim(),
          isFinal: true,
          source: 'final',
        })
      } else {
        session.interimText = transcript
        // Flux's `transcript` field is per-turn, not cumulative
        // (https://developers.deepgram.com/docs/flux/state). After a turn
        // closes with EndOfTurn and a new turn opens, every Update event
        // emits ONLY the new turn's words. Earlier finalized turns live in
        // `finalTexts` and were never reannounced. If the host renders the
        // raw interim transcript, the composer flashes back to "just the
        // current turn" the moment turn N+1's first interim arrives, and
        // the user watches the previous sentences disappear mid-recording.
        // Emit the cumulative text (committed turns + open turn) so the
        // host can paint a stable preview. Use `chooseDeepgramStreamingTranscriptText`
        // so the same containment/equality rules that govern the final
        // outcome also govern the live preview — no surprise visual
        // divergence between "what I see while talking" and "what I see
        // after release".
        const finalsAccumulated = session.finalTexts.join(' ').replace(/\s+/g, ' ').trim()
        const cumulative = chooseDeepgramStreamingTranscriptText(finalsAccumulated, transcript)
        session.onTranscript({
          id: session.id,
          text: cumulative.text,
          isFinal: false,
          source: 'interim',
        })
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

    // Early-finalize path. Once we have stopped sending audio AND Deepgram
    // commits a turn, there is nothing more to wait for — finalize on the
    // EndOfTurn instead of waiting for the socket close handshake. This is
    // the difference between "transcribing…" hanging for the full watchdog
    // window vs. resolving the moment the model is actually done.
    //
    // Without this path, the previous trace truncated the user's last word
    // because we only had the latest interim when the socket closed; with
    // it, we capture the committed final transcript as soon as it arrives
    // and close the socket from our side. finalizeSession is idempotent
    // (guards on sessions.has), so the eventual close-handler invocation
    // is a no-op.
    if (session.stopped && isFinal) {
      trace(session, 'deepgram:end-of-turn:finalize', {
        runId: session.id,
        elapsedMs: Date.now() - session.startedAt,
      })
      finalizeSession(session)
      try {
        session.ws.close()
      } catch {
        /* noop */
      }
    }
  }

  function finalizeSession(session: DeepgramStreamingSession): void {
    if (!sessions.has(session.id)) return
    sessions.delete(session.id)

    const finalText = session.finalTexts.join(' ').replace(/\s+/g, ' ').trim()
    const interimText = session.interimText.trim()
    const { text, source } = chooseDeepgramStreamingTranscriptText(finalText, interimText)
    const sttDoneAt = Date.now()

    trace(session, 'deepgram:complete', {
      runId: session.id,
      sttMs: sttDoneAt - session.startedAt,
      chunkCount: session.chunkCount,
      audioBytes: session.audioBytes,
      wsSentChunks: session.wsSentChunks,
      wsSentBytes: session.wsSentBytes,
      textChars: text.length,
      finalChars: finalText.length,
      interimChars: interimText.length,
      selectedTextSource: source,
      usedInterimFallback: source === 'interim',
    })

    session.resolve({
      id: session.id,
      startedAt: session.startedAt,
      text,
      provider: 'deepgram',
      model,
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

  return { start, pushChunk, stop, cancel }
}

export function chooseDeepgramStreamingTranscriptText(
  finalText: string,
  interimText: string,
): { text: string; source: 'final' | 'interim' | 'empty' } {
  if (!finalText && !interimText) return { text: '', source: 'empty' }
  if (!finalText) return { text: interimText, source: 'interim' }
  if (!interimText) return { text: finalText, source: 'final' }
  if (finalText === interimText) return { text: finalText, source: 'final' }

  // Flux multi-turn rules:
  //
  //   - Each EndOfTurn appends a committed turn to `finalTexts`; we receive
  //     them here joined as `finalText`.
  //   - `interimText` is whatever the CURRENTLY OPEN turn is showing — the
  //     trailing live transcript the user has not yet paused after.
  //
  // Three possible relationships between the two:
  //
  //   1. `interimText` extends the most recent final ("Hello" → "Hello world"
  //      mid-turn). Returning interim alone is correct because it is a
  //      strict superset.
  //   2. `finalText` already contains `interimText` — the open turn just
  //      finalized as the same string, or the interim is an older snapshot
  //      that was already committed. Returning final alone is correct.
  //   3. Neither contains the other. This is the failure case that lost
  //      whole sentences before the fix below: a user who spoke turn A,
  //      paused, then started turn B would have `finalText` from turn A and
  //      `interimText` from turn B. The old rule "longer wins" picked
  //      whichever happened to be longer and silently dropped the other.
  //      The right answer is to surface BOTH, in turn order, with a single
  //      space between — finals always come first because finalTexts is
  //      committed-in-order and interim is the still-open turn.
  if (interimText.includes(finalText)) return { text: interimText, source: 'interim' }
  if (finalText.includes(interimText)) return { text: finalText, source: 'final' }
  return { text: `${finalText} ${interimText}`, source: 'final' }
}

function extractDeepgramTranscript(message: Record<string, unknown>): string {
  if (typeof message.transcript === 'string') return message.transcript.trim()
  const channel = message.channel as Record<string, unknown> | undefined
  const alternatives = channel?.alternatives as unknown[] | undefined
  const first = alternatives?.[0] as Record<string, unknown> | undefined
  return typeof first?.transcript === 'string' ? first.transcript.trim() : ''
}

function chunkToBuffer(chunk: ArrayBuffer | Uint8Array): Buffer {
  if (chunk instanceof ArrayBuffer) return Buffer.from(chunk)
  return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
}

function trace(
  session: DeepgramStreamingSession,
  phase: string,
  details: Record<string, unknown>,
): void {
  session.onTrace({
    provider: 'deepgram',
    phase,
    ...details,
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
