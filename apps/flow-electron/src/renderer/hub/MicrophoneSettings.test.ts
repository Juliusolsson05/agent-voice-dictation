import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MicrophoneSettings } from './MicrophoneSettings'

let view: ReactTestRenderer
let devices: EventTarget & { enumerateDevices: ReturnType<typeof vi.fn>; getUserMedia: ReturnType<typeof vi.fn> }
let events: Record<string, () => void>
let track: EventTarget & { label: string; readyState: string; stop: ReturnType<typeof vi.fn> }
let close: ReturnType<typeof vi.fn<() => Promise<void>>>
let onChange: ReturnType<typeof vi.fn<(deviceId: string | null) => Promise<void>>>
let contextFailure = false

beforeEach(() => {
  events = {}
  onChange = vi.fn().mockResolvedValue(undefined)
  track = Object.assign(new EventTarget(), { label: 'iPhone', readyState: 'live', stop: vi.fn() })
  devices = Object.assign(new EventTarget(), {
    enumerateDevices: vi.fn().mockResolvedValue([{ kind: 'audioinput', deviceId: 'iphone', label: 'iPhone' }]),
    getUserMedia: vi.fn().mockResolvedValue({ getAudioTracks: () => [track], getTracks: () => [track] }),
  })
  close = vi.fn().mockResolvedValue(undefined)
  contextFailure = false
  vi.stubGlobal('navigator', { mediaDevices: devices })
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }))
  vi.stubGlobal('window', { flow: { events: {
    onHotkeyDown: (fn: () => void) => { events.down = fn; return () => { delete events.down } },
    onHotkeyFired: (fn: () => void) => { events.toggle = fn; return () => { delete events.toggle } },
  } } })
  vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(7))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('AudioContext', class {
    state = 'running'
    constructor() { if (contextFailure) throw new Error('No audio device') }
    close() { this.state = 'closed'; return close() }
    resume() { return Promise.resolve() }
    createMediaStreamSource() { return { connect: vi.fn(), disconnect: vi.fn() } }
    createAnalyser() { return { fftSize: 1024, getFloatTimeDomainData: vi.fn() } }
  })
})

afterEach(() => {
  if (view) act(() => view.unmount())
  vi.unstubAllGlobals()
})

async function mount(deviceId: string | null = 'iphone') {
  await act(async () => { view = create(React.createElement(MicrophoneSettings, { deviceId, onChange })) })
}

async function click(label: string) {
  await act(async () => {
    view.root.findAllByType('button').find(button => button.children.includes(label))!.props.onClick()
  })
}

it('lists inputs without capture and persists selection through the provided settings boundary', async () => {
  await mount()
  expect(devices.getUserMedia).not.toHaveBeenCalled()
  expect(view.root.findByType('select').props.value).toBe('iphone')
  await act(async () => { await view.root.findByType('select').props.onChange({ target: { value: '' } }) })
  expect(onChange).toHaveBeenCalledWith(null)
  expect(devices.getUserMedia).not.toHaveBeenCalled()
})

it('opens only the selected mic locally, then releases both capture and meter on stop', async () => {
  await mount()
  await click('Test microphone')
  expect(devices.getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: 'iphone' } }, video: false })
  expect(view.root.findByProps({ role: 'status' }).children.join('')).toContain('Listening locally: iPhone')
  await click('Stop test')
  expect(track.stop).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledOnce()
})

it.each(['unmount', 'selection', 'hotkey', 'hidden', 'disconnect'])('releases the mic on %s', async reason => {
  await mount()
  await click('Test microphone')
  await act(async () => {
    if (reason === 'unmount') view.unmount()
    if (reason === 'selection') view.update(React.createElement(MicrophoneSettings, { deviceId: null, onChange }))
    if (reason === 'hotkey') events.down()
    if (reason === 'hidden') {
      Object.assign(document, { hidden: true })
      document.dispatchEvent(new Event('visibilitychange'))
    }
    if (reason === 'disconnect') track.dispatchEvent(new Event('ended'))
  })
  expect(track.stop).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledOnce()
})

it('retains an unplugged selection and refreshes when the device returns', async () => {
  await mount()
  devices.enumerateDevices.mockResolvedValue([])
  await act(async () => { devices.dispatchEvent(new Event('devicechange')) })
  expect(view.root.findByType('select').props.value).toBe('iphone')
  expect(view.root.findAllByType('option')[1].children.join('')).toContain('Saved microphone')
  devices.enumerateDevices.mockResolvedValue([{ kind: 'audioinput', deviceId: 'iphone', label: 'iPhone' }])
  await act(async () => { devices.dispatchEvent(new Event('devicechange')) })
  expect(view.root.findAllByType('option')[1].children.join('')).toBe('iPhone')
  expect(onChange).not.toHaveBeenCalled()
})

it('reports denied permissions and permits retry without uploading or leaving capture active', async () => {
  await mount()
  devices.getUserMedia.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
  await click('Test microphone')
  expect(view.root.findByProps({ role: 'alert' }).children.join('')).toContain('System Settings')
  await click('Test microphone')
  expect(view.root.findByProps({ role: 'status' }).children.join('')).toContain('Listening locally')
})

it('releases capture if audio graph setup fails', async () => {
  await mount()
  contextFailure = true
  await click('Test microphone')
  expect(track.stop).toHaveBeenCalledOnce()
  expect(view.root.findByProps({ role: 'alert' }).children.join('')).toBe('No audio device')
})

it('closes a microphone granted after the settings panel was dismissed', async () => {
  let grant!: (stream: unknown) => void
  devices.getUserMedia.mockImplementation(() => new Promise(resolve => { grant = resolve }))
  await mount()
  await click('Test microphone')
  act(() => view.unmount())
  await act(async () => { grant({ getTracks: () => [track] }) })
  expect(track.stop).toHaveBeenCalledOnce()
  expect(close).not.toHaveBeenCalled()
})

it('shows a save failure instead of claiming the selection was saved', async () => {
  await mount()
  onChange.mockRejectedValueOnce(new Error('disk full'))
  await act(async () => { await view.root.findByType('select').props.onChange({ target: { value: '' } }) })
  expect(view.root.findByProps({ role: 'alert' }).children.join('')).toContain('Could not save')
})
