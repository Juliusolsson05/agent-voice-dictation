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
  const recRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)

  const stopMeter = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    analyserRef.current = null
    if (audioCtxRef.current) {
      void audioCtxRef.current.close()
      audioCtxRef.current = null
    }
  }, [])

  const startMeter = useCallback((stream: MediaStream) => {
    // AudioContext + AnalyserNode is the cheapest accurate level
    // meter. We sample peak amplitude per RAF tick — good enough for
    // a 4-bar visualizer at 60Hz, and we don't keep the FFT buffer
    // around between frames so memory stays flat.
    const ctx = new AudioContext()
    const src = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    src.connect(analyser)
    audioCtxRef.current = ctx
    analyserRef.current = analyser
    const data = new Uint8Array(analyser.fftSize)
    const tick = () => {
      const a = analyserRef.current
      if (!a) return
      a.getByteTimeDomainData(data)
      let peak = 0
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i] - 128) / 128
        if (v > peak) peak = v
      }
      // Slight smoothing — dampens jitter on quiet input.
      setLevel(prev => prev * 0.6 + peak * 0.4)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      chunksRef.current = []
      rec.addEventListener('dataavailable', evt => {
        if (evt.data.size > 0) chunksRef.current.push(evt.data)
      })
      rec.addEventListener('stop', async () => {
        // The mic stream must be torn down BEFORE we await the
        // network request so the OS shows "mic released" promptly.
        streamRef.current?.getTracks().forEach(t => t.stop())
        streamRef.current = null
        stopMeter()

        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        chunksRef.current = []
        if (blob.size === 0) {
          setState('idle')
          await window.flow.status.hide()
          return
        }
        setState('transcribing')
        try {
          const buf = await blob.arrayBuffer()
          await window.flow.dictation.run(buf, blob.type)
        } catch (err) {
          setError((err as Error)?.message ?? String(err))
          setState('error')
          // Leave the pill visible briefly on error so the user sees
          // the red flash, then hide.
          window.setTimeout(() => void window.flow.status.hide(), 1800)
          return
        }
        setState('idle')
        await window.flow.status.hide()
      })
      rec.start(100)
      recRef.current = rec
      setState('recording')
      setError(null)
      startMeter(stream)
    } catch (err) {
      setError((err as Error)?.message ?? String(err))
      setState('error')
      window.setTimeout(() => void window.flow.status.hide(), 1800)
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
    chunksRef.current = []
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

  return (
    <MicPill
      state={state}
      level={level}
      error={error}
      handsFree={true /* settings drive this in phase-3 polish; default on for now */}
      onStop={stopRecording}
      onCancel={cancelRecording}
    />
  )
}
