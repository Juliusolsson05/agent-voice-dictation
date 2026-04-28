import type { SpeechTranscript } from './types.js'

export function requireTranscriptText(transcript: SpeechTranscript): SpeechTranscript {
  if (transcript.text.trim()) return transcript
  throw new Error(`Provider ${transcript.provider} returned an empty transcript`)
}
