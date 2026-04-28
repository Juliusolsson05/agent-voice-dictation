import type { RecorderChunk, RecordingResult } from './types.js'

export type BrowserRecorder = {
  start(): Promise<void>
  stop(): Promise<RecordingResult>
  cancel(): void
  readonly stream: MediaStream | null
  readonly mimeType: string
}

export function createBrowserRecorder(opts: {
  mimeType?: string
  audioBitsPerSecond?: number
  timesliceMs?: number
  mediaStreamConstraints?: MediaStreamConstraints
} = {}): BrowserRecorder {
  let recorder: MediaRecorder | null = null
  let stream: MediaStream | null = null
  let startedAt = 0
  let chunks: RecorderChunk[] = []
  const mimeType = opts.mimeType ?? pickSupportedMimeType()

  return {
    get stream() {
      return stream
    },
    get mimeType() {
      return mimeType
    },
    async start() {
      if (recorder?.state === 'recording') return
      chunks = []
      stream = await navigator.mediaDevices.getUserMedia(
        opts.mediaStreamConstraints ?? { audio: true },
      )
      const recorderOptions: MediaRecorderOptions = { mimeType }
      if (opts.audioBitsPerSecond !== undefined) {
        recorderOptions.audioBitsPerSecond = opts.audioBitsPerSecond
      }
      recorder = new MediaRecorder(stream, recorderOptions)
      recorder.ondataavailable = event => {
        if (event.data.size === 0) return
        chunks.push({ blob: event.data, timestampMs: Date.now() })
      }
      startedAt = Date.now()
      recorder.start(opts.timesliceMs)
    },
    stop() {
      return new Promise((resolve, reject) => {
        if (!recorder || recorder.state === 'inactive') {
          reject(new Error('Recorder is not active'))
          return
        }
        recorder.onerror = event => reject(event.error)
        recorder.onstop = () => {
          const durationMs = Date.now() - startedAt
          const audio = new Blob(chunks.map(chunk => chunk.blob), { type: mimeType })
          stopStream(stream)
          stream = null
          resolve({ audio, mimeType, durationMs, chunks })
        }
        recorder.stop()
      })
    },
    cancel() {
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      stopStream(stream)
      stream = null
      chunks = []
    },
  }
}

function pickSupportedMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ]
  return candidates.find(candidate => MediaRecorder.isTypeSupported(candidate)) ?? ''
}

function stopStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop()
}
