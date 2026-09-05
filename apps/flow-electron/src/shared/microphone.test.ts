import { describe, expect, it, vi } from 'vitest'
import { MicrophoneCapture, microphoneOptions, normalizeMicrophoneDeviceId, openMicrophone } from './microphone'

function stream() {
  const stop = vi.fn()
  return { value: { getTracks: () => [{ stop }] } as unknown as MediaStream, stop }
}

describe('microphone selection', () => {
  it('uses the current system default unless a specific device is selected', async () => {
    const getUserMedia = vi.fn().mockResolvedValue(stream().value)
    await openMicrophone({ getUserMedia }, null)
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: true, video: false })
    await openMicrophone({ getUserMedia }, 'iphone')
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: { deviceId: { exact: 'iphone' } }, video: false })
  })

  it('does not fall back to another microphone after device removal or permission denial', async () => {
    for (const name of ['OverconstrainedError', 'NotFoundError', 'NotAllowedError']) {
      const error = new DOMException('Unavailable', name)
      const getUserMedia = vi.fn().mockRejectedValue(error)
      await expect(openMicrophone({ getUserMedia }, 'iphone')).rejects.toBe(error)
      expect(getUserMedia).toHaveBeenCalledTimes(1)
    }
  })

  it('normalizes legacy/default/malformed settings without discarding real ids', () => {
    for (const value of [undefined, null, '', '  ', 'default', 42, {}]) {
      expect(normalizeMicrophoneDeviceId(value)).toBeNull()
    }
    expect(normalizeMicrophoneDeviceId('iphone-device-id')).toBe('iphone-device-id')
  })

  it('keeps named physical inputs, excluding aliases, duplicates, outputs and hidden ids', () => {
    const devices = [
      { deviceId: 'default', kind: 'audioinput', label: 'Default' },
      { deviceId: 'communications', kind: 'audioinput', label: 'Communications' },
      { deviceId: 'iphone', kind: 'audioinput', label: 'iPhone Microphone' },
      { deviceId: 'iphone', kind: 'audioinput', label: 'Duplicate' },
      { deviceId: 'speaker', kind: 'audiooutput', label: 'Speaker' },
      { deviceId: 'camera', kind: 'videoinput', label: 'Camera' },
      { deviceId: '', kind: 'audioinput', label: '' },
      { deviceId: 'usb', kind: 'audioinput', label: '' },
    ] as MediaDeviceInfo[]
    expect(microphoneOptions(devices)).toEqual([
      { deviceId: 'iphone', label: 'iPhone Microphone' },
      { deviceId: 'usb', label: 'Microphone 2 (name needs permission)' },
    ])
  })
})

describe('microphone ownership', () => {
  it('releases a stream that arrives after stop or unmount', async () => {
    let resolve!: (value: MediaStream) => void
    const capture = new MicrophoneCapture({ getUserMedia: () => new Promise(r => { resolve = r }) })
    const request = capture.open('iphone')
    capture.stop()
    const late = stream()
    resolve(late.value)
    expect(await request).toBeNull()
    expect(late.stop).toHaveBeenCalledOnce()
  })

  it('does not let an older permission response replace a newer test', async () => {
    let resolve!: (value: MediaStream) => void
    const old = stream()
    const current = stream()
    const getUserMedia = vi.fn()
      .mockImplementationOnce(() => new Promise(r => { resolve = r }))
      .mockResolvedValueOnce(current.value)
    const capture = new MicrophoneCapture({ getUserMedia })
    const first = capture.open('iphone')
    expect(await capture.open('usb')).toBe(current.value)
    resolve(old.value)
    expect(await first).toBeNull()
    expect(old.stop).toHaveBeenCalledOnce()
    expect(current.stop).not.toHaveBeenCalled()
    capture.stop()
    capture.stop()
    expect(current.stop).toHaveBeenCalledOnce()
  })

  it('ignores a dismissed request failure but reports the current request failure', async () => {
    let reject!: (error: Error) => void
    const getUserMedia = vi.fn().mockImplementation(() => new Promise((_r, fail) => { reject = fail }))
    const capture = new MicrophoneCapture({ getUserMedia })
    const request = capture.open(null)
    capture.stop()
    reject(new Error('Dismissed'))
    expect(await request).toBeNull()
    getUserMedia.mockRejectedValue(new Error('Denied'))
    await expect(capture.open(null)).rejects.toThrow('Denied')
  })
})

describe('automatic iPhone selection', () => {
  const automatic = 'agent-voice:auto-iphone'
  const input = (id: string, label: string) => ({ deviceId: id, label, kind: 'audioinput' }) as MediaDeviceInfo

  it('resolves the current phone id again after wireless reconnection', async () => {
    const getUserMedia = vi.fn().mockResolvedValue(stream().value)
    const enumerateDevices = vi.fn()
      .mockResolvedValueOnce([input('mac', 'MacBook Microphone'), input('old', 'Julius’s iPhone Microphone')])
      .mockResolvedValueOnce([input('new', 'Julius’s iPhone Microphone')])
    await openMicrophone({ getUserMedia, enumerateDevices }, automatic)
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: { deviceId: { exact: 'old' } }, video: false })
    await openMicrophone({ getUserMedia, enumerateDevices }, automatic)
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: { deviceId: { exact: 'new' } }, video: false })
  })

  it('never opens a different mic when the phone is missing, unnamed or ambiguous', async () => {
    const getUserMedia = vi.fn()
    for (const list of [[], [input('mac', 'MacBook Microphone')], [input('hidden', '')],
      [input('one', 'iPhone Microphone'), input('two', 'Continuity Microphone')]]) {
      await expect(openMicrophone({ getUserMedia, enumerateDevices: async () => list }, automatic)).rejects.toThrow()
    }
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('releases a late phone stream after cancellation during discovery', async () => {
    let discover!: (value: MediaDeviceInfo[]) => void
    const audio = stream()
    const capture = new MicrophoneCapture({ getUserMedia: async () => audio.value,
      enumerateDevices: () => new Promise(resolve => { discover = resolve }) })
    const request = capture.open(automatic)
    capture.stop()
    discover([input('phone', 'iPhone')])
    expect(await request).toBeNull()
    expect(audio.stop).toHaveBeenCalledOnce()
  })
})
