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

export function audioToBody(audio: AudioInput): Blob {
  return audioToBlob(audio)
}

// `formFile` previously took a fallbackName argument that nothing read; the
// real fallback is in `fileName()` because that is the multipart filename the
// provider sees. Keep these helpers separate so each call site reads as
// "blob to upload" and "name the provider should see" without callers having
// to remember which one the fallback name belongs to.
export function formFile(audio: AudioInput): Blob {
  return audioToBlob(audio)
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
