// One selection vocabulary for persisted settings, the local test and dictation.
// "Default" must stay dynamic; persisting today's default device id would stop
// following macOS when the user changes its input in Control Center.
export function normalizeMicrophoneDeviceId(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value === 'default') return null
  return value
}

export type MicrophoneOption = { deviceId: string; label: string }

// Persist intent rather than a Chromium id: Continuity devices can be assigned a
// different id after reconnecting. This token is never passed to getUserMedia.
export const AUTO_IPHONE = 'agent-voice:auto-iphone'
type CaptureDevices = Pick<MediaDevices, 'getUserMedia'> & Partial<Pick<MediaDevices, 'enumerateDevices'>>

export function iPhoneMicrophones(devices: readonly MicrophoneOption[]): MicrophoneOption[] {
  // Web media APIs provide labels, not Apple's native transport/device type.
  // Be conservative: a renamed phone without either label needs explicit
  // selection. Never guess that an arbitrary external microphone is an iPhone.
  return devices.filter(device => /\biphone\b|\bcontinuity\b/i.test(device.label))
}

export function microphoneOptions(devices: readonly MediaDeviceInfo[]): MicrophoneOption[] {
  const seen = new Set<string>()
  return devices.filter(device => {
    // Chromium exposes default/communications aliases alongside physical devices.
    // Only our explicit default option should follow changing system routing.
    if (device.kind !== 'audioinput' || !device.deviceId
      || device.deviceId === 'default' || device.deviceId === 'communications'
      || seen.has(device.deviceId)) return false
    seen.add(device.deviceId)
    return true
  }).map((device, index) => ({
    deviceId: device.deviceId,
    label: device.label || `Microphone ${index + 1} (name needs permission)`,
  }))
}

export async function openMicrophone(
  devices: CaptureDevices,
  selectedId: string | null,
): Promise<MediaStream> {
  let deviceId = normalizeMicrophoneDeviceId(selectedId)
  if (deviceId === AUTO_IPHONE) {
    const candidates = iPhoneMicrophones(microphoneOptions(await devices.enumerateDevices?.() ?? []))
    if (candidates.length === 0) {
      throw new Error('iPhone microphone is not available to macOS yet. Keep it nearby and locked with Continuity Camera, Wi-Fi and Bluetooth on. Then try again. No other microphone was opened.')
    }
    if (candidates.length > 1) {
      throw new Error('More than one iPhone microphone is available. Choose your phone by name in Settings.')
    }
    deviceId = candidates[0].deviceId
  }
  // Exact is intentional: "ideal" silently falls back if an iPhone disconnects,
  // potentially capturing a room mic the user did not choose. Surface an error
  // and let the user deliberately select System default instead.
  return devices.getUserMedia({
    audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    video: false,
  })
}

export function microphoneErrorMessage(error: unknown): string {
  const name = (error as { name?: string } | null)?.name
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return 'Microphone permission denied. Allow microphone access in System Settings, then try again.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'Microphone unavailable. Reconnect it or choose another input in Settings.'
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'Microphone could not start. Check its connection and whether another app is using it.'
  }
  return (error as { message?: string } | null)?.message || 'Microphone failed. Check your input in Settings.'
}

// getUserMedia has no AbortSignal and its permission prompt may outlive the UI.
// Ownership therefore has to survive unmount: a cancelled request still releases
// every track if it eventually succeeds. It must never replace a newer test.
export class MicrophoneCapture {
  private generation = 0
  private stream: MediaStream | null = null

  constructor(private devices: CaptureDevices) {}

  async open(deviceId: string | null): Promise<MediaStream | null> {
    this.stop()
    const generation = this.generation
    try {
      const stream = await openMicrophone(this.devices, deviceId)
      if (generation !== this.generation) {
        stream.getTracks().forEach(track => track.stop())
        return null
      }
      this.stream = stream
      return stream
    } catch (error) {
      if (generation !== this.generation) return null
      throw error
    }
  }

  stop(): void {
    this.generation += 1
    this.stream?.getTracks().forEach(track => track.stop())
    this.stream = null
  }
}
