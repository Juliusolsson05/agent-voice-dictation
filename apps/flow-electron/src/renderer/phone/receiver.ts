import type { PhoneEvent, PhoneSignal } from '../../shared/phoneMic'

type Bridge = {
  signal(id: string, signal: PhoneSignal): Promise<void>
  receiverState(id: string, ready: boolean, level: number, error?: string): Promise<void>
  onSignal(handler: (event: PhoneEvent) => void): () => void
}

// This peer belongs to the long-lived status renderer, not the settings modal.
// Closing settings or releasing a dictation key must not disconnect the phone.
// Each dictation gets cloned tracks so its existing teardown remains correct.
export class PhoneReceiver {
  private active = false
  private id = ''
  private peer: RTCPeerConnection | null = null
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private timer?: ReturnType<typeof setInterval>
  private deadline?: ReturnType<typeof setTimeout>
  private off?: () => void
  private chain = Promise.resolve()
  private clones = new Set<MediaStreamTrack>()
  constructor(private bridge: Bridge, private onLost: () => void, private createPeer = () => new RTCPeerConnection({ iceServers: [] })) {}
  start() {
    this.active = true
    this.off = this.bridge.onSignal(event => {
      this.chain = this.chain.then(() => this.receive(event)).catch(() => {
        const id = this.id
        this.reset()
        void this.bridge.receiverState(id, false, 0, 'Phone audio connection failed. Reconnect from the phone.').catch(() => {})
      })
    })
  }
  private async receive(event: PhoneEvent) {
    if (!this.active) return
    if ('disconnected' in event) { if (event.id === this.id) this.reset(); return }
    if (event.signal.type === 'offer') {
      this.reset(); this.id = event.id
      const id = event.id, pc = this.createPeer(); this.peer = pc
      let answered = false
      const candidates: PhoneSignal[] = []
      pc.onicecandidate = event => {
        if (!event.candidate || this.peer !== pc) return
        const signal: PhoneSignal = { type: 'candidate', candidate: event.candidate.toJSON() }
        if (answered) void this.bridge.signal(id, signal).catch(() => {})
        else candidates.push(signal)
      }
      pc.ontrack = event => {
        if (event.track.kind !== 'audio' || this.peer !== pc || this.stream) return
        this.stream = new MediaStream([event.track])
        event.track.onended = () => this.failed(pc, 'Phone microphone stopped. Reconnect from the phone.')
        event.track.onmute = () => { if (this.peer === pc) void this.bridge.receiverState(id, false, 0, 'Phone audio paused. Keep Chrome visible.').catch(() => {}) }
        this.meter(pc, id, this.stream)
      }
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') clearTimeout(this.deadline)
        if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) this.failed(pc, 'Phone disconnected. Tap Connect on the phone again.')
      }
      this.deadline = setTimeout(() => this.failed(pc, 'Phone connection timed out. Check whether Wi-Fi blocks device-to-device traffic.'), 20000)
      await pc.setRemoteDescription(event.signal)
      if (this.peer !== pc) return
      await pc.setLocalDescription(await pc.createAnswer())
      if (this.peer === pc) {
        await this.bridge.signal(id, { type: 'answer', sdp: pc.localDescription!.sdp })
        if (this.peer !== pc) return
        answered = true
        for (const signal of candidates) await this.bridge.signal(id, signal)
      }
    } else if (event.id === this.id && event.signal.type === 'candidate') {
      await this.peer?.addIceCandidate(event.signal.candidate)
    }
  }
  private failed(pc: RTCPeerConnection, message: string) {
    if (this.peer !== pc) return
    const id = this.id; this.reset()
    void this.bridge.receiverState(id, false, 0, message).catch(() => {})
  }
  private meter(pc: RTCPeerConnection, id: string, stream: MediaStream) {
    const context = new AudioContext(); this.context = context
    const analyser = context.createAnalyser(); analyser.fftSize = 1024
    context.createMediaStreamSource(stream).connect(analyser)
    void context.resume().catch(() => {})
    const data = new Float32Array(analyser.fftSize)
    this.timer = setInterval(() => {
      if (this.peer !== pc) return
      analyser.getFloatTimeDomainData(data)
      const level = Math.min(1, Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length) * 5)
      const track = stream.getAudioTracks()[0]
      void this.bridge.receiverState(id, pc.connectionState === 'connected' && !track.muted && track.readyState === 'live', level).catch(() => {})
    }, 200)
  }
  open(): MediaStream {
    const track = this.stream?.getAudioTracks()[0]
    if (this.peer?.connectionState !== 'connected' || !track || track.readyState !== 'live' || track.muted) {
      throw new Error('Phone microphone is not ready. Open the pairing page in Chrome on your phone and tap Connect.')
    }
    // Prune stopped dictation tracks before adding the next clone; keep live
    // clones so a broken phone connection can immediately end every consumer.
    for (const clone of this.clones) if (clone.readyState === 'ended') this.clones.delete(clone)
    const clone = track.clone(); this.clones.add(clone)
    return new MediaStream([clone])
  }
  private reset() {
    const hadStream = !!this.stream
    const pc = this.peer; this.peer = null; this.id = ''
    if (pc) { pc.onconnectionstatechange = null; pc.ontrack = null; pc.onicecandidate = null; pc.close() }
    clearInterval(this.timer); clearTimeout(this.deadline)
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null
    this.clones.forEach(track => track.stop()); this.clones.clear()
    void this.context?.close().catch(() => {}); this.context = null
    if (hadStream) this.onLost()
  }
  dispose() { this.active = false; this.off?.(); this.reset() }
}
