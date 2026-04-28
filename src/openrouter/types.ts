export type RecentContextMessage = {
  role: 'user' | 'assistant' | 'system'
  text: string
}

export type RecentContext = {
  target?: 'agent-composer' | 'general-dictation' | undefined
  precedingText?: string | undefined
  selectedText?: string | undefined
  recentMessages?: RecentContextMessage[] | undefined
  projectHints?: string[] | undefined
}

export type PolishTranscriptOptions = {
  apiKey: string
  rawTranscript: string
  recentContext?: RecentContext | undefined
  model?: string | undefined
  baseUrl?: string | undefined
  appTitle?: string | undefined
  appReferer?: string | undefined
  signal?: AbortSignal | undefined
}

export type PolishedTranscript = {
  text: string
  model: string
  raw?: unknown
}
