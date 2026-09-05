export const PHONE_MIC = 'agent-voice:lan-phone'
export type PhoneSignal = { type: 'offer' | 'answer'; sdp: string } | { type: 'candidate'; candidate: RTCIceCandidateInit }
export type PhoneEvent = { id: string; signal: PhoneSignal } | { id: string; disconnected: true }
export type PhoneStatus = {
  running: boolean
  urls: string[]
  fingerprint: string
  connected: boolean
  ready: boolean
  level: number
  error: string | null
}
export const emptyPhoneStatus = (): PhoneStatus => ({ running: false, urls: [], fingerprint: '', connected: false, ready: false, level: 0, error: null })

// The LAN client has no Electron privileges. Validate the small signaling
// vocabulary before it crosses IPC; arbitrary phone JSON is never an IPC name.
export function validPhoneSignal(value: unknown, fromPhone = true): value is PhoneSignal {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  if (item.type === (fromPhone ? 'offer' : 'answer')) {
    return typeof item.sdp === 'string' && item.sdp.length < 48000 && item.sdp.includes('m=audio') && !item.sdp.includes('m=video')
  }
  if (item.type !== 'candidate' || !item.candidate || typeof item.candidate !== 'object') return false
  const candidate = item.candidate as Record<string, unknown>
  return typeof candidate.candidate === 'string' && candidate.candidate.length < 2048
    && (candidate.sdpMid == null || typeof candidate.sdpMid === 'string')
    && (candidate.sdpMLineIndex == null || Number.isInteger(candidate.sdpMLineIndex))
}
