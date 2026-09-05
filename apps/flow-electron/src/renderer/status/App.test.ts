import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from './App'
import { PhoneReceiver } from '../phone/receiver'

vi.mock('./MicPill', () => ({ MicPill: (props: unknown) => React.createElement('div', props as object) }))
vi.mock('./sounds', () => ({ playOpenSound: vi.fn(), playCloseSound: vi.fn() }))

let view: ReactTestRenderer
let events: Record<string, () => void>
let selected: string | null
let getUserMedia: ReturnType<typeof vi.fn<() => Promise<unknown>>>
let stopTrack: ReturnType<typeof vi.fn>
let streamStart: ReturnType<typeof vi.fn>
let streamCancel: ReturnType<typeof vi.fn>

beforeEach(() => {
  events = {}
  selected = 'iphone'
  stopTrack = vi.fn()
  const track = { label: 'iPhone', stop: stopTrack }
  getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track], getAudioTracks: () => [track] })
  streamStart = vi.fn().mockResolvedValue({ id: 'session' })
  streamCancel = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  vi.stubGlobal('window', {
    setTimeout: vi.fn().mockReturnValue(1), clearTimeout: vi.fn(),
    flow: {
      phone: { onSignal: vi.fn(() => () => {}), receiverState: vi.fn().mockResolvedValue(undefined) },
      settings: { get: vi.fn(async () => ({ microphoneDeviceId: selected, playSounds: false, handsFreeMode: false })) },
      dictation: { streamStart, streamCancel },
      status: { hide: vi.fn().mockResolvedValue(undefined) },
      events: Object.fromEntries(['onHotkeyDown', 'onHotkeyUp', 'onHotkeyFired', 'onStatusOpening', 'onStatusClosing']
        .map(name => [name, (fn: () => void) => { events[name] = fn; return () => { delete events[name] } }])),
    },
  })
  vi.stubGlobal('MediaRecorder', class extends EventTarget {
    static isTypeSupported() { return true }
    state = 'inactive'
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive'; this.dispatchEvent(new Event('stop')) }
    requestData() {}
  })
  vi.stubGlobal('AudioContext', class {
    sampleRate = 48000
    close = vi.fn().mockResolvedValue(undefined)
    resume = vi.fn().mockResolvedValue(undefined)
    createMediaStreamSource() { return { connect: vi.fn() } }
    createAnalyser() { return { frequencyBinCount: 512 } }
  })
  vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  if (view) act(() => view.unmount())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function mount() { await act(async () => { view = create(React.createElement(App)) }) }
async function start() { await act(async () => { events.onHotkeyDown() }) }

it('records from the persisted selection and reloads a changed input for the next dictation', async () => {
  await mount()
  await start()
  expect(getUserMedia).toHaveBeenLastCalledWith({ audio: { deviceId: { exact: 'iphone' } }, video: false })
  expect(streamStart).toHaveBeenCalledOnce()
  // Cancel is an intentional discard, so the test never needs a provider or
  // fake transcript. The next key press must read the newly saved preference.
  await act(async () => { view.root.findByType('div').props.onCancel() })
  expect(stopTrack).toHaveBeenCalled()
  expect(streamCancel).toHaveBeenCalledWith('session')
  selected = null
  await start()
  expect(getUserMedia).toHaveBeenLastCalledWith({ audio: true, video: false })
})

it('shows a missing-device error without falling back or starting transcription', async () => {
  getUserMedia.mockRejectedValue(new DOMException('Gone', 'OverconstrainedError'))
  await mount()
  await start()
  expect(getUserMedia).toHaveBeenCalledOnce()
  expect(streamStart).not.toHaveBeenCalled()
  expect(view.root.findByType('div').props.error).toContain('Microphone unavailable')
})

it('releases a permission grant that arrives after the recording renderer unmounts', async () => {
  let grant!: (stream: unknown) => void
  getUserMedia.mockImplementation(() => new Promise(resolve => { grant = resolve }))
  await mount()
  await start()
  act(() => view.unmount())
  await act(async () => { grant({ getTracks: () => [{ stop: stopTrack }] }) })
  expect(stopTrack).toHaveBeenCalledOnce()
  expect(streamStart).not.toHaveBeenCalled()
})

it('stops an active recording and cancels its provider session on unmount', async () => {
  await mount()
  await start()
  act(() => view.unmount())
  expect(stopTrack).toHaveBeenCalledOnce()
  expect(streamCancel).toHaveBeenCalledWith('session')
})

it('does not open a local microphone or provider when the selected LAN phone is disconnected', async () => {
  selected = 'agent-voice:lan-phone'
  await mount(); await start()
  expect(getUserMedia).not.toHaveBeenCalled()
  expect(streamStart).not.toHaveBeenCalled()
  expect(view.root.findByType('div').props.error).toContain('Phone microphone is not ready')
})

it('uses the connected phone stream with the existing provider pipeline and releases only its borrowed track', async () => {
  selected = 'agent-voice:lan-phone'
  const remoteTrack = { label: 'LAN phone', stop: stopTrack }
  vi.spyOn(PhoneReceiver.prototype, 'open').mockReturnValue({ getTracks: () => [remoteTrack], getAudioTracks: () => [remoteTrack] } as unknown as MediaStream)
  await mount(); await start()
  expect(getUserMedia).not.toHaveBeenCalled()
  expect(streamStart).toHaveBeenCalledOnce()
  await act(async () => { view.root.findByType('div').props.onCancel() })
  expect(stopTrack).toHaveBeenCalledOnce()
  expect(streamCancel).toHaveBeenCalledWith('session')
})
