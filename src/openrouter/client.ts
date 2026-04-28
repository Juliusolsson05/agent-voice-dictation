import type { PolishedTranscript, PolishTranscriptOptions } from './types.js'
import { buildTranscriptPolishMessages } from './prompt.js'

export class OpenRouterError extends Error {
  readonly status: number | undefined
  readonly details: unknown

  constructor(message: string, opts: { status?: number; details?: unknown } = {}) {
    super(message)
    this.name = 'OpenRouterError'
    this.status = opts.status
    this.details = opts.details
  }
}

export async function polishTranscriptWithOpenRouter(
  options: PolishTranscriptOptions,
): Promise<PolishedTranscript> {
  if (!options.apiKey.trim()) throw new OpenRouterError('Missing OpenRouter API key')
  if (!options.rawTranscript.trim()) {
    return {
      text: '',
      model: options.model ?? defaultOpenRouterPolishModel,
    }
  }
  const model = options.model ?? defaultOpenRouterPolishModel
  const response = await fetch(`${options.baseUrl ?? 'https://openrouter.ai/api/v1'}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      'content-type': 'application/json',
      ...(options.appReferer ? { 'http-referer': options.appReferer } : {}),
      ...(options.appTitle ? { 'x-openrouter-title': options.appTitle } : {}),
    },
    body: JSON.stringify({
      model,
      messages: buildTranscriptPolishMessages(options.rawTranscript, options.recentContext),
      temperature: 0,
    }),
    signal: options.signal ?? null,
  })
  if (!response.ok) {
    throw new OpenRouterError('OpenRouter polish request failed', {
      status: response.status,
      details: await readErrorBody(response),
    })
  }
  const raw = await response.json() as Record<string, unknown>
  const choices = raw.choices as Array<Record<string, unknown>> | undefined
  const message = choices?.[0]?.message as Record<string, unknown> | undefined
  const text = typeof message?.content === 'string' ? message.content.trim() : ''
  return { text, model, raw }
}

// Kept as a single exported constant so host apps can override in
// their settings while still showing the library default in UI. The
// OpenRouter model namespace is not a speech concern, which is why it
// lives here instead of under speech/.
export const defaultOpenRouterPolishModel = 'deepseek/deepseek-v4-flash'

async function readErrorBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '')
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
