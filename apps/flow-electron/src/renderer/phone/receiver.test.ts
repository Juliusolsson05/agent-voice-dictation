import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PhoneReceiver } from './receiver'
import type { PhoneEvent, PhoneSignal } from '../../shared/phoneMic'

class Track {
  kind = 'audio'; readyState = 'live'; muted = false
  onended?: () => void; onmute?: () => void
  stop() { this.readyState = 'ended' }
  clone() { return new Track() }
}
class Stream {
  constructor(private tracks: Track[]) {}
  getTracks() { return this.tracks }
  getAudioTracks() { return this.tracks }
}
class Peer {
  connectionState = 'new'
  onicecandidate?: (event: unknown) => void
  onconnectionstatechange?: () => void
  ontrack?: (event: { track: Track }) => void
  localDescription = { type: 'answer', sdp: 'm=audio 9 RTP/AVP 0' }
  async setRemoteDescription() {}
  async createAnswer() { return this.localDescription }
  async setLocalDescription() { this.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: 'candidate:test' }) } }) }
  async addIceCandidate() {}
  close() { this.connectionState = 'closed'; this.onconnectionstatechange?.() }
}
let receiver: PhoneReceiver
let signal: (event: PhoneEvent) => void
let peer: Peer
let lost: ReturnType<typeof vi.fn<() => void>>
let send: ReturnType<typeof vi.fn<(id: string, signal: PhoneSignal) => Promise<void>>>
const offer = { id: 'phone-one', signal: { type: 'offer' as const, sdp: 'm=audio 9 RTP/AVP 0' } }
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve() }
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('MediaStream', Stream)
  vi.stubGlobal('AudioContext', class {
    resume() { return Promise.resolve() }; close() { return Promise.resolve() }
    createMediaStreamSource() { return { connect() {} } }
    createAnalyser() { return { fftSize: 1024, getFloatTimeDomainData() {} } }
  })
  peer = new Peer(); lost = vi.fn(); send = vi.fn().mockResolvedValue(undefined)
  receiver = new PhoneReceiver({ signal: send, receiverState: vi.fn().mockResolvedValue(undefined), onSignal: handler => { signal = handler; return () => {} } }, lost, () => peer as unknown as RTCPeerConnection)
  receiver.start()
})
afterEach(() => { receiver.dispose(); vi.useRealTimers(); vi.unstubAllGlobals() })
it('orders SDP before ICE and lends independent recording tracks without ending the paired microphone', async () => {
  signal(offer); await settle()
  expect(send.mock.calls.map(call => call[1].type)).toEqual(['answer', 'candidate'])
  const original = new Track(); peer.ontrack?.({ track: original }); peer.connectionState = 'connected'
  const first = receiver.open(); first.getTracks()[0].stop()
  expect(original.readyState).toBe('live')
  const second = receiver.open()
  expect(second.getTracks()[0].readyState).toBe('live')
  signal({ id: 'old-connection', disconnected: true }); await settle()
  expect(second.getTracks()[0].readyState).toBe('live')
  signal({ id: 'phone-one', disconnected: true }); await settle()
  expect(second.getTracks()[0].readyState).toBe('ended')
  expect(lost).toHaveBeenCalledOnce()
  expect(() => receiver.open()).toThrow('not ready')
})
it('ignores a queued offer after the renderer is disposed', async () => {
  signal(offer); receiver.dispose(); await settle()
  expect(send).not.toHaveBeenCalled()
})
it('rejects a muted or disconnected phone instead of returning silent audio', async () => {
  signal(offer); await settle()
  const track = new Track(); peer.ontrack?.({ track }); peer.connectionState = 'connected'
  track.muted = true
  expect(() => receiver.open()).toThrow('not ready')
  track.muted = false; peer.connectionState = 'disconnected'; peer.onconnectionstatechange?.()
  expect(lost).toHaveBeenCalledOnce()
  expect(track.readyState).toBe('ended')
})
