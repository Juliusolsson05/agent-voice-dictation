import type { AudioInput } from './types.js'

export function audioToBlob(audio: AudioInput): Blob {
  if (audio.data instanceof Blob) return audio.data
  if (audio.data instanceof Uint8Array) {
    const copy = audio.data.slice()
    return new Blob([copy.buffer], {
      type: audio.mimeType ?? 'application/octet-stream',
    })
  }
  return new Blob([audio.data], {
    type: audio.mimeType ?? 'application/octet-stream',
  })
}

export function audioToBody(audio: AudioInput): BodyInit {
  return audioToBlob(audio)
}

export function formFile(audio: AudioInput, fallbackName: string): Blob {
  return audioToBlob(audio).slice(0, undefined, audio.mimeType ?? 'application/octet-stream')
}

export function fileName(audio: AudioInput, fallbackName: string): string {
  return audio.filename ?? fallbackName
}

export function numberSecondsToMs(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 1000)
    : undefined
}

export function numberMs(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : undefined
}
