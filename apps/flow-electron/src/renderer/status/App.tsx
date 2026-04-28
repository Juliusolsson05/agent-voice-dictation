import { useCallback, useEffect, useRef, useState } from 'react'

import { MicPill } from './MicPill'

// The Status window's job:
//   1. Listen for `hotkey:fired` from main.
//   2. First fire opens the mic and starts recording.
//   3. Second fire stops recording, sends audio to main for STT/polish.
//   4. Show the recording state visually (audio bars).
//   5. Auto-hide after the dictation completes.
//
// Mic capture uses the package's recorder helpers indirectly: we use
// MediaRecorder + AudioContext directly here because the package's
// browser recorder is for browser environments and we want the Status
// window's recording lifecycle to be self-contained (the Hub never
// records, only reads recents).
//
// Why we record in the renderer and run STT in main:
//   - getUserMedia is only available in renderer (Web APIs).
//   - API keys + provider HTTP calls live in main (secrets boundary).
// The audio buffer crosses the IPC boundary as an ArrayBuffer.

type State = 'idle' | 'recording' | 'transcribing' | 'error'
type LifecycleState = State | 'starting' | 'stopping'

const EMPTY_LEVELS = [0, 0, 0, 0, 0, 0, 0]
const MIN_HOLD_TO_TRANSCRIBE_MS = 180
const ERROR_VISIBLE_MS = 1800
const VOICE_BANDS_HZ: Array<[number, number]> = [
  [120, 240],
  [240, 420],
  [420, 700],
  [700, 1100],
  [1100, 1700],
  [1700, 2600],
  [2600, 3800],
]

export function App() {
  const [state, setState] = useState<State>('idle')
  const [levels, setLevels] = useState<number[]>(EMPTY_LEVELS)
  const [error, setError] = useState<string | null>(null)
  const [handsFree, setHandsFree] = useState(false)
  const [visible, setVisible] = useState(true)
  const recRef = useRef<MediaRecorder | null>(null)
  const lifecycleRef = useRef<LifecycleState>('idle')
  const pendingStopRef = useRef(false)
  const stoppingRef = useRef(false)
  const discardStopRef = useRef(false)
  const streamSessionIdRef = useRef<string | null>(null)
  const streamStartPromiseRef = useRef<Promise<void> | null>(null)
  const errorResetTimerRef = useRef<number | null>(null)
  const queuedAudioChunksRef = useRef<Array<{ index: number; buffer: ArrayBuffer; recordedAt: number }>>([])
  const pendingChunkSendsRef = useRef<Promise<void>[]>([])
  const recordingGenerationRef = useRef(0)
  const recordingStartedAtRef = useRef(0)
  const hotkeyDownAtRef = useRef(0)
  const chunkIndexRef = useRef(0)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const levelRefs = useRef<number[]>([...EMPTY_LEVELS])
  const noiseFloorRef = useRef<number[]>(VOICE_BANDS_HZ.map(() => 0.08))

  const stopMeter = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    analyserRef.current = null
    levelRefs.current = [...EMPTY_LEVELS]
    noiseFloorRef.current = VOICE_BANDS_HZ.map(() => 0.08)
    setLevels(EMPTY_LEVELS)
    if (audioCtxRef.current) {
      void audioCtxRef.current.close()
      audioCtxRef.current = null
    }
  }, [])

  const resetToIdle = useCallback(() => {
    if (errorResetTimerRef.current !== null) {
      window.clearTimeout(errorResetTimerRef.current)
      errorResetTimerRef.current = null
    }
    lifecycleRef.current = 'idle'
    pendingStopRef.current = false
    stoppingRef.current = false
    discardStopRef.current = false
    streamSessionIdRef.current = null
    queuedAudioChunksRef.current = []
    pendingChunkSendsRef.current = []
    streamStartPromiseRef.current = null
    recordingGenerationRef.current += 1
    hotkeyDownAtRef.current = 0
    setState('idle')
    setError(null)
  }, [])

  const showTransientError = useCallback((message: string, err?: unknown) => {
    // Error must be a visual event, not a terminal lifecycle state. The first
    // version left `lifecycleRef` as "error", so every later hotkey press was
    // ignored until the app was restarted. That is poison for a hold-to-talk
    // tool where accidental taps and empty captures are normal. We flash the
    // failure, clean up native resources, then return to idle so the next press
    // is always a fresh attempt.
    if (err) console.error('[status] dictation failed', err)
    setError(message)
    lifecycleRef.current = 'error'
    setState('error')
    errorResetTimerRef.current = window.setTimeout(() => {
      resetToIdle()
      void window.flow.status.hide()
    }, ERROR_VISIBLE_MS)
  }, [resetToIdle])

  const startMeter = useCallback((stream: MediaStream) => {
    // AudioContext + AnalyserNode is the cheapest accurate local meter. This is
    // only a visual affordance; Deepgram is the actual speech source of truth.
    //
    // The first meter used one RMS number for the whole waveform, which meant
    // every bar was the same signal wearing different weights. That can feel
    // delayed or fake because a voice is not a single scalar; consonants,
    // vowels, and room noise live in different frequency ranges. Here each bar
    // tracks a speech-frequency band and subtracts a slowly moving noise floor.
    // The pill still keeps its sine-curve personality in MicPill, but the
    // amplitude now comes from actual microphone energy per band.
    const ctx = new AudioContext()
    const src = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    analyser.minDecibels = -92
    analyser.maxDecibels = -22
    analyser.smoothingTimeConstant = 0.12
    src.connect(analyser)
    audioCtxRef.current = ctx
    analyserRef.current = analyser
    void ctx.resume()
    const frequencyData = new Uint8Array(analyser.frequencyBinCount)
    const bandBins = VOICE_BANDS_HZ.map(([low, high]) => ({
      start: Math.max(1, Math.floor(low / (ctx.sampleRate / analyser.fftSize))),
      end: Math.max(2, Math.ceil(high / (ctx.sampleRate / analyser.fftSize))),
    }))
    const tick = () => {
      const a = analyserRef.current
      if (!a) return
      a.getByteFrequencyData(frequencyData)
      const next = bandBins.map(({ start, end }, i) => {
        let sum = 0
        let count = 0
        for (let bin = start; bin <= end && bin < frequencyData.length; bin++) {
          sum += frequencyData[bin] / 255
          count += 1
        }
        const energy = count ? sum / count : 0
        const previousFloor = noiseFloorRef.current[i] ?? 0.08
        const floorRate = energy < previousFloor ? 0.08 : 0.006
        const floor = previousFloor + (energy - previousFloor) * floorRate
        noiseFloorRef.current[i] = floor

        const voiceEnergy = Math.max(0, energy - floor - 0.012)
        const signal = Math.min(1, Math.pow(voiceEnergy * 8.5, 0.72))
        const previous = levelRefs.current[i] ?? 0
        const attack = signal > previous ? 0.74 : 0.22
        return previous + (signal - previous) * attack
      })
      levelRefs.current = next
      setLevels(next)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  const startRecording = useCallback(async () => {
    if (lifecycleRef.current !== 'idle') return
    hotkeyDownAtRef.current ||= Date.now()
    lifecycleRef.current = 'starting'
    pendingStopRef.current = false
    try {
      const recordingGeneration = ++recordingGenerationRef.current
      const startRequestedAt = Date.now()
      console.log('[status:trace] start:begin', {
        hotkeyToStartMs: startRequestedAt - hotkeyDownAtRef.current,
      })
      const settings = await window.flow.settings.get()
      setHandsFree(settings.handsFreeMode)
      console.log('[status:trace] settings:loaded', {
        ms: Date.now() - startRequestedAt,
        handsFreeMode: settings.handsFreeMode,
      })
      const gumStartedAt = Date.now()
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      console.log('[status:trace] get-user-media:done', {
        ms: Date.now() - gumStartedAt,
        tracks: stream.getAudioTracks().map(track => ({
          label: track.label,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
        })),
      })
      streamRef.current = stream
      const mimeType = pickRecordingMimeType()
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      stoppingRef.current = false
      discardStopRef.current = false
      pendingChunkSendsRef.current = []
      queuedAudioChunksRef.current = []
      chunkIndexRef.current = 0
      rec.addEventListener('dataavailable', evt => {
        const chunkRecordedAt = Date.now()
        const chunkIndex = ++chunkIndexRef.current
        console.log('[status:trace] recorder:chunk', {
          index: chunkIndex,
          size: evt.data.size,
          type: evt.data.type,
          elapsedMs: chunkRecordedAt - recordingStartedAtRef.current,
        })
        if (evt.data.size > 0) {
          const pending = evt.data.arrayBuffer().then(async buffer => {
            if (recordingGeneration !== recordingGenerationRef.current) {
              console.log('[status:trace] recorder:chunk:discard-stale', {
                index: chunkIndex,
                bytes: buffer.byteLength,
                generation: recordingGeneration,
                currentGeneration: recordingGenerationRef.current,
              })
              return
            }
            const sessionId = streamSessionIdRef.current
            if (!sessionId) {
              queuedAudioChunksRef.current.push({ index: chunkIndex, buffer, recordedAt: chunkRecordedAt })
              console.log('[status:trace] recorder:chunk:queued-local', {
                index: chunkIndex,
                bytes: buffer.byteLength,
                queuedLocal: queuedAudioChunksRef.current.length,
              })
              return
            }
            console.log('[status:trace] recorder:chunk:ipc-send', {
              index: chunkIndex,
              bytes: buffer.byteLength,
              sessionId,
              sendLagMs: Date.now() - chunkRecordedAt,
            })
            await window.flow.dictation.streamChunk(sessionId, buffer)
          })
          pendingChunkSendsRef.current.push(pending)
          void pending.finally(() => {
            pendingChunkSendsRef.current = pendingChunkSendsRef.current.filter(item => item !== pending)
          })
        }
      })
      rec.addEventListener('error', evt => {
        // eslint-disable-next-line no-console
        console.error('[status] recorder error', evt.error)
        showTransientError(evt.error?.message ?? 'Recorder failed', evt.error)
      })
      rec.addEventListener('stop', async () => {
        // The mic stream must be torn down BEFORE we await the
        // network request so the OS shows "mic released" promptly.
        streamRef.current?.getTracks().forEach(t => t.stop())
        streamRef.current = null
        stopMeter()

        stoppingRef.current = false
        if (discardStopRef.current) {
          console.log('[status:trace] recorder:stop:discarded')
          resetToIdle()
          void window.flow.status.hide()
          return
        }
        lifecycleRef.current = 'transcribing'
        setState('transcribing')
        try {
          await streamStartPromiseRef.current
          const sessionId = streamSessionIdRef.current
          streamSessionIdRef.current = null
          if (!sessionId) throw new Error('No active Deepgram stream')
          await Promise.allSettled(pendingChunkSendsRef.current)
          pendingChunkSendsRef.current = []
          await window.flow.dictation.streamStop(sessionId)
        } catch (err) {
          const message = (err as Error)?.message ?? String(err)
          showTransientError(message, err)
          return
        }
        resetToIdle()
        await window.flow.status.hide()
      })
      // Deepgram Flux recommends low-latency streaming chunks. 80ms is small
      // enough for turn detection to stay responsive while still using
      // MediaRecorder's WebM/Opus container path instead of writing an
      // AudioWorklet resampler in v1.
      rec.start(80)
      recRef.current = rec
      recordingStartedAtRef.current = Date.now()
      console.log('[status:trace] recorder:started', {
        mimeType,
        startLatencyMs: recordingStartedAtRef.current - hotkeyDownAtRef.current,
        localStartMs: recordingStartedAtRef.current - startRequestedAt,
        state: rec.state,
      })
      const streamStartStartedAt = Date.now()
      const streamStartPromise = window.flow.dictation.streamStart(mimeType || undefined)
        .then(async streamSession => {
          if (discardStopRef.current || recordingGeneration !== recordingGenerationRef.current) {
            console.log('[status:trace] deepgram-session:discard-after-ready', {
              streamSessionId: streamSession.id,
              ms: Date.now() - streamStartStartedAt,
              generation: recordingGeneration,
              currentGeneration: recordingGenerationRef.current,
            })
            await window.flow.dictation.streamCancel(streamSession.id)
            return
          }
          streamSessionIdRef.current = streamSession.id
          console.log('[status:trace] deepgram-session:ready', {
            streamSessionId: streamSession.id,
            ms: Date.now() - streamStartStartedAt,
            queuedLocal: queuedAudioChunksRef.current.length,
          })
          const queued = queuedAudioChunksRef.current.splice(0)
          for (const queuedChunk of queued) {
            console.log('[status:trace] recorder:chunk:ipc-send-queued', {
              index: queuedChunk.index,
              bytes: queuedChunk.buffer.byteLength,
              sessionId: streamSession.id,
              queueLagMs: Date.now() - queuedChunk.recordedAt,
            })
            await window.flow.dictation.streamChunk(streamSession.id, queuedChunk.buffer)
          }
        })
        .finally(() => {
          streamStartPromiseRef.current = null
        })
      streamStartPromiseRef.current = streamStartPromise
      void streamStartPromise.catch(() => {})
      lifecycleRef.current = 'recording'
      setState('recording')
      setError(null)
      startMeter(stream)
      if (pendingStopRef.current) {
        pendingStopRef.current = false
        window.setTimeout(() => stopRecording(), 0)
      }
    } catch (err) {
      const message = (err as Error)?.message ?? String(err)
      // eslint-disable-next-line no-console
      console.error('[status] start recording failed', err)
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
      stopMeter()
      showTransientError(message, err)
    }
  }, [resetToIdle, showTransientError, startMeter, stopMeter])

  const stopRecording = useCallback(() => {
    if (lifecycleRef.current === 'starting') {
      pendingStopRef.current = true
      return
    }
    if (lifecycleRef.current !== 'recording') return
    const heldMs = hotkeyDownAtRef.current ? Date.now() - hotkeyDownAtRef.current : null
    const rec = recRef.current
    if (rec && rec.state !== 'inactive' && !stoppingRef.current) {
      lifecycleRef.current = 'stopping'
      stoppingRef.current = true
      if (heldMs !== null && heldMs < MIN_HOLD_TO_TRANSCRIBE_MS) {
        // Very short presses are almost always accidental key taps or "I hit
        // the wrong hotkey" events. Sending those through Deepgram produces
        // noisy "No speech detected" errors and can leave the user feeling like
        // the app broke. Treat them as cancel/discard, but keep the trace so we
        // can tune the threshold if it ever eats intentional short commands.
        discardStopRef.current = true
        console.log('[status:trace] recorder:short-press-discard', {
          heldMs,
          thresholdMs: MIN_HOLD_TO_TRANSCRIBE_MS,
        })
        const sessionId = streamSessionIdRef.current
        streamSessionIdRef.current = null
        if (sessionId) void window.flow.dictation.streamCancel(sessionId)
      }
      // `MediaRecorder.stop()` should emit a final dataavailable event, but an
      // abrupt hotkey release can still race the encoder and our IPC close path.
      // Requesting data first gives Chromium one explicit chance to flush the
      // current WebM/Opus page before we close the Deepgram stream.
      try {
        rec.requestData()
      } catch {
        /* noop */
      }
      window.setTimeout(() => {
        if (rec.state !== 'inactive') rec.stop()
      }, 35)
    }
  }, [])

  const cancelRecording = useCallback(() => {
    // Cancel discards the buffer entirely and hides the pill. Used
    // by the X button in hands-free mode.
    const sessionId = streamSessionIdRef.current
    streamSessionIdRef.current = null
    stoppingRef.current = false
    discardStopRef.current = true
    pendingChunkSendsRef.current = []
    if (sessionId) void window.flow.dictation.streamCancel(sessionId)
    const rec = recRef.current
    const recorderWasActive = !!rec && rec.state !== 'inactive'
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop()
      } catch {
        /* noop */
      }
    }
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    stopMeter()
    if (!recorderWasActive) {
      resetToIdle()
      void window.flow.status.hide()
    }
  }, [resetToIdle, stopMeter])

  // macOS default is true hold-to-talk: the native helper emits explicit
  // press/release events because Electron's globalShortcut cannot represent the
  // release side of Fn, bare modifiers, or physical-key bindings. The old
  // `hotkey:fired` toggle channel remains only for non-macOS fallback.
  useEffect(() => {
    const offDown = window.flow.events.onHotkeyDown(() => {
      setVisible(true)
      if (lifecycleRef.current === 'error') resetToIdle()
      hotkeyDownAtRef.current = Date.now()
      console.log('[status:trace] hotkey:down', { at: hotkeyDownAtRef.current })
      if (lifecycleRef.current === 'idle') {
        void startRecording()
      }
    })
    const offUp = window.flow.events.onHotkeyUp(() => {
      console.log('[status:trace] hotkey:up', {
        at: Date.now(),
        heldMs: hotkeyDownAtRef.current ? Date.now() - hotkeyDownAtRef.current : null,
        lifecycle: lifecycleRef.current,
      })
      if (lifecycleRef.current === 'recording' || lifecycleRef.current === 'starting') {
        stopRecording()
      }
    })
    const offToggleFallback = window.flow.events.onHotkeyFired(() => {
      setVisible(true)
      if (lifecycleRef.current === 'error') resetToIdle()
      if (lifecycleRef.current === 'idle') {
        void startRecording()
      } else if (lifecycleRef.current === 'recording' || lifecycleRef.current === 'starting') {
        stopRecording()
      }
    })
    return () => {
      offDown()
      offUp()
      offToggleFallback()
    }
  }, [resetToIdle, startRecording, stopRecording])

  useEffect(() => {
    const offOpening = window.flow.events.onStatusOpening(() => setVisible(true))
    const offClosing = window.flow.events.onStatusClosing(() => setVisible(false))
    return () => {
      offOpening()
      offClosing()
    }
  }, [])

  useEffect(() => {
    void window.flow.settings.get().then(settings => {
      setHandsFree(settings.handsFreeMode)
    })
  }, [])

  return (
    <MicPill
      state={state}
      levels={levels}
      error={error}
      handsFree={handsFree}
      visible={visible}
      onStop={stopRecording}
      onCancel={cancelRecording}
    />
  )
}

function pickRecordingMimeType(): string {
  // Chromium/Electron support varies by OS build. Passing an
  // unsupported mimeType to MediaRecorder can make start/stop fail in
  // confusing ways. We pick the first supported format and allow the
  // browser default only if none of our preferred formats is reported.
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ]
  return candidates.find(candidate => MediaRecorder.isTypeSupported(candidate)) ?? ''
}
