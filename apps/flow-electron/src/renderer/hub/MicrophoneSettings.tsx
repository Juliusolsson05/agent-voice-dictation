import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  MicrophoneCapture,
  microphoneErrorMessage,
  microphoneOptions,
  type MicrophoneOption,
} from '../../shared/microphone'

type Props = {
  deviceId: string | null
  onChange: (deviceId: string | null) => Promise<void>
}

export function MicrophoneSettings({ deviceId, onChange }: Props) {
  const [devices, setDevices] = useState<MicrophoneOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'starting' | 'testing'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [activeName, setActiveName] = useState('')
  const [level, setLevel] = useState(0)
  const capture = useRef<MicrophoneCapture | null>(null)
  const cleanupMeter = useRef<(() => void) | null>(null)
  const mounted = useRef(false)
  const refreshGeneration = useRef(0)

  const stop = useCallback(() => {
    capture.current?.stop()
    cleanupMeter.current?.()
    cleanupMeter.current = null
    if (mounted.current) {
      setPhase('idle')
      setLevel(0)
      setActiveName('')
    }
  }, [])

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      if (mounted.current && generation === refreshGeneration.current) {
        setDevices(microphoneOptions(list))
        setLoading(false)
      }
    } catch (err) {
      if (mounted.current && generation === refreshGeneration.current) {
        setLoading(false)
        setError(microphoneErrorMessage(err))
      }
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    capture.current = new MicrophoneCapture(navigator.mediaDevices)
    // Merely viewing settings must not turn on the microphone. Labels can be
    // unavailable before permission; the explicit Test button unlocks them.
    void refresh()
    const onDeviceChange = () => { void refresh() }
    const onVisibility = () => {
      if (document.hidden) stop()
      else void refresh()
    }
    navigator.mediaDevices.addEventListener('devicechange', onDeviceChange)
    document.addEventListener('visibilitychange', onVisibility)
    // Dictation owns capture priority. A local test must not contend with the
    // status window or leave a second microphone open after the dictation ends.
    const offDown = window.flow.events.onHotkeyDown(stop)
    const offToggle = window.flow.events.onHotkeyFired(stop)
    return () => {
      mounted.current = false
      refreshGeneration.current += 1
      stop()
      offDown()
      offToggle()
      navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refresh, stop])

  useEffect(() => { stop() }, [deviceId, stop])

  const test = async () => {
    setError(null)
    setPhase('starting')
    try {
      const stream = await capture.current!.open(deviceId)
      if (!stream) return
      const track = stream.getAudioTracks()[0]
      if (!track || track.readyState === 'ended') {
        throw new Error('Microphone unavailable. Reconnect it or choose another input.')
      }
      const ended = () => {
        stop()
        setError('Microphone disconnected. Reconnect it or choose another input.')
        void refresh()
      }
      const context = new AudioContext()
      let source: MediaStreamAudioSourceNode | null = null
      let frame = 0
      // Install cleanup before constructing graph nodes: device removal and
      // AudioContext errors must close the stream even during partial setup.
      cleanupMeter.current = () => {
        track.removeEventListener('ended', ended)
        cancelAnimationFrame(frame)
        source?.disconnect()
        void context.close().catch(() => {})
      }
      track.addEventListener('ended', ended, { once: true })
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      source = context.createMediaStreamSource(stream)
      source.connect(analyser)
      // No connection to destination, no MediaRecorder, no dictation IPC:
      // this meter never plays back, stores or uploads the test audio.
      const data = new Float32Array(analyser.fftSize)
      const tick = () => {
        analyser.getFloatTimeDomainData(data)
        const rms = Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length)
        setLevel(Math.min(1, rms * 5))
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
      setActiveName(track.label || 'Selected microphone')
      setPhase('testing')
      void refresh()
      void context.resume().catch(() => {
        if (context.state === 'closed') return
        stop()
        if (mounted.current) setError('Could not start the input meter. Try testing again.')
      })
    } catch (err) {
      stop()
      if (mounted.current) setError(microphoneErrorMessage(err))
    }
  }

  const change = async (next: string) => {
    stop()
    setSaving(true)
    setError(null)
    try {
      await onChange(next || null)
    } catch {
      if (mounted.current) setError('Could not save the microphone selection. Please try again.')
    } finally {
      if (mounted.current) setSaving(false)
    }
  }

  const unavailable = !!deviceId && !devices.some(device => device.deviceId === deviceId)
  return (
    <div style={{ display: 'grid', gap: 10, minWidth: 0 }}>
      <select
        className="input"
        style={{ minWidth: 0, maxWidth: '100%' }}
        aria-label="Microphone"
        aria-describedby="microphone-help"
        value={deviceId ?? ''}
        disabled={saving}
        onChange={event => { void change(event.target.value) }}
      >
        <option value="">System default</option>
        {unavailable && <option value={deviceId!}>Saved microphone (unavailable or permission needed)</option>}
        {devices.map(device => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
      </select>
      <p id="microphone-help" style={{ margin: 0, fontSize: 11, color: 'var(--ink-dim)' }}>
        Changes apply to the next dictation. A selected microphone never silently switches to another.
        iPhone inputs appear when connected through macOS Continuity Camera.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn" disabled={saving}
          onClick={() => { if (phase === 'idle') void test(); else stop() }}>
          {phase === 'starting' ? 'Cancel microphone test' : phase === 'testing' ? 'Stop test' : 'Test microphone'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => { void refresh() }}>Refresh inputs</button>
      </div>
      <meter aria-label="Microphone input level" min={0} max={1} value={level} style={{ width: '100%' }} />
      <span role="status" style={{ fontSize: 11, color: 'var(--ink-dim)' }}>
        {saving ? 'Saving selection…' : phase === 'testing' ? `Listening locally: ${activeName}`
          : phase === 'starting' ? 'Waiting for microphone access…'
          : loading ? 'Checking available inputs…' : 'Test audio stays on this device. The microphone is off until you test or dictate.'}
      </span>
      {unavailable && !loading && <span style={{ fontSize: 11, color: 'var(--ink-dim)' }}>
        Reconnect your saved microphone, test to grant access, or select System default.
      </span>}
      {error && <span role="alert" style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</span>}
    </div>
  )
}
