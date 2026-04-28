export type RecorderStatus =
  | 'idle'
  | 'requesting-mic'
  | 'recording'
  | 'stopped'
  | 'error'

export type RecorderChunk = {
  blob: Blob
  timestampMs: number
}

export type RecordingResult = {
  audio: Blob
  mimeType: string
  durationMs: number
  chunks: RecorderChunk[]
}

export type AudioLevelSample = {
  rms: number
  peak: number
  timestampMs: number
}
