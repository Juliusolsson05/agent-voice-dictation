import type { SpeechProviderId } from './types.js'

export class SpeechProviderError extends Error {
  readonly provider: SpeechProviderId
  readonly status: number | undefined
  readonly details: unknown

  constructor(
    provider: SpeechProviderId,
    message: string,
    opts: { status?: number; details?: unknown } = {},
  ) {
    super(message)
    this.name = 'SpeechProviderError'
    this.provider = provider
    this.status = opts.status
    this.details = opts.details
  }
}

export async function readErrorBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '')
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export function assertApiKey(provider: SpeechProviderId, apiKey: string): void {
  if (!apiKey.trim()) {
    throw new SpeechProviderError(provider, 'Missing API key')
  }
}
