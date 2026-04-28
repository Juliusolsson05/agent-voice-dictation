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

export function App() {
  const [state, setState] = useState<State>('idle')
  const [level, setLevel] = useState(0) // 0..1 visualizer signal
  const [error, setError] = useState<string | null>(null)
  const [handsFree, setHandsFree] = useState(false)
  const recRef = useRef<MediaRecorder | null>(null)
  const streamSessionIdRef = useRef<string | null>(null)
  const pendingChunkSendsRef = useRef<Promise<void>[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const levelRef = useRef(0)

  const stopMeter = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    analyserRef.current = null
    levelRef.current = 0
    setLevel(0)
    if (audioCtxRef.current) {
      void audioCtxRef.current.close()
      audioCtxRef.current = null
    }
  }, [])

  const startMeter = useCallback((stream: MediaStream) => {
    // AudioContext + AnalyserNode is the cheapest accurate local meter. This is
    // only a visual affordance; Deepgram is the actual speech source of truth.
    // The meter needs to feel immediate, so we avoid heavy smoothing and use an
    // asymmetric envelope: very fast attack when speech starts, slower release
    // when speech drops. That tracks syllables without flickering off between
    // words.
    const ctx = new AudioContext()
    const src = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0
    src.connect(analyser)
    audioCtxRef.current = ctx
    analyserRef.current = analyser
    const data = new Uint8Array(analyser.fftSize)
    const tick = () => {
      const a = analyserRef.current
      if (!a) return
      a.getByteTimeDomainData(data)
      let sum = 0
      let peak = 0
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i] - 128) / 128
        sum += v * v
        if (v > peak) peak = v
      }
      const rms = Math.sqrt(sum / data.length)
      const rawSignal = Math.max(peak * 2.2, rms * 11)
      const gatedSignal = rawSignal < 0.025 ? 0 : rawSignal
      const signal = Math.min(1, gatedSignal)
      const previous = levelRef.current
      const attack = signal > previous ? 0.82 : 0.26
      const next = previous + (signal - previous) * attack
      levelRef.current = next
      setLevel(next)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  const startRecording = useCallback(async () => {
    try {
      const settings = await window.flow.settings.get()
      setHandsFree(settings.handsFreeMode)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = pickRecordingMimeType()
      const streamSession = await window.flow.dictation.streamStart(mimeType || undefined)
      streamSessionIdRef.current = streamSession.id
      // eslint-disable-next-line no-console
      console.log('[status] starting streaming recorder', {
        mimeType,
        streamSessionId: streamSession.id,
      })
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      pendingChunkSendsRef.current = []
      rec.addEventListener('dataavailable', evt => {
        // eslint-disable-next-line no-console
        console.log('[status] recorder chunk', {
          size: evt.data.size,
          type: evt.data.type,
        })
        const sessionId = streamSessionIdRef.current
        if (evt.data.size > 0 && sessionId) {
          const pending = evt.data.arrayBuffer().then(buffer => {
            window.flow.dictation.streamChunk(sessionId, buffer)
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
        setError(evt.error?.message ?? 'Recorder failed')
        setState('error')
      })
      rec.addEventListener('stop', async () => {
        // The mic stream must be torn down BEFORE we await the
        // network request so the OS shows "mic released" promptly.
        streamRef.current?.getTracks().forEach(t => t.stop())
        streamRef.current = null
        stopMeter()

        const sessionId = streamSessionIdRef.current
        streamSessionIdRef.current = null
        setState('transcribing')
        try {
          if (!sessionId) throw new Error('No active Deepgram stream')
          await Promise.allSettled(pendingChunkSendsRef.current)
          pendingChunkSendsRef.current = []
          await window.flow.dictation.streamStop(sessionId)
        } catch (err) {
          const message = (err as Error)?.message ?? String(err)
          // eslint-disable-next-line no-console
          console.error('[status] dictation failed', err)
          setError(message)
          setState('error')
          // Leave the pill visible briefly on error so the user sees
          // the red flash, then hide.
          window.setTimeout(() => void window.flow.status.hide(), 3600)
          return
        }
        setState('idle')
        await window.flow.status.hide()
      })
      // Deepgram Flux recommends low-latency streaming chunks. 80ms is small
      // enough for turn detection to stay responsive while still using
      // MediaRecorder's WebM/Opus container path instead of writing an
      // AudioWorklet resampler in v1.
      rec.start(80)
      recRef.current = rec
      setState('recording')
      setError(null)
      startMeter(stream)
    } catch (err) {
      const message = (err as Error)?.message ?? String(err)
      // eslint-disable-next-line no-console
      console.error('[status] start recording failed', err)
      setError(message)
      setState('error')
      window.setTimeout(() => void window.flow.status.hide(), 3600)
    }
  }, [startMeter, stopMeter])

  const stopRecording = useCallback(() => {
    const rec = recRef.current
    if (rec && rec.state !== 'inactive') {
      rec.stop()
    }
  }, [])

  const cancelRecording = useCallback(() => {
    // Cancel discards the buffer entirely and hides the pill. Used
    // by the X button in hands-free mode.
    const sessionId = streamSessionIdRef.current
    streamSessionIdRef.current = null
    pendingChunkSendsRef.current = []
    if (sessionId) void window.flow.dictation.streamCancel(sessionId)
    const rec = recRef.current
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
    setState('idle')
    void window.flow.status.hide()
  }, [stopMeter])

  // Hotkey behavior: first fire toggles recording on, next fire
  // toggles it off. This is a simple toggle in v1 because Electron's
  // globalShortcut only fires once per press. A future native module
  // can implement true press-and-hold.
  useEffect(() => {
    const off = window.flow.events.onHotkeyFired(() => {
      if (state === 'idle') {
        void startRecording()
      } else if (state === 'recording') {
        stopRecording()
      }
    })
    return off
  }, [state, startRecording, stopRecording])

  useEffect(() => {
    void window.flow.settings.get().then(settings => {
      setHandsFree(settings.handsFreeMode)
    })
  }, [])

  return (
    <MicPill
      state={state}
      level={level}
      error={error}
      handsFree={handsFree}
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
