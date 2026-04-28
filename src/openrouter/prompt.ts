import type { RecentContext } from './types.js'

export function buildTranscriptPolishMessages(
  rawTranscript: string,
  recentContext?: RecentContext,
): Array<{ role: 'system' | 'user'; content: string }> {
  const context = formatContext(recentContext)
  return [
    {
      role: 'system',
      content:
        'You clean voice dictation for an agent composer. Output only the final cleaned text. ' +
        'Remove filler words, false starts, repeated hesitation, and dictation artifacts. ' +
        'Interpret spoken corrections like "no no", "scratch that", "delete that", and ' +
        '"instead say" as editing instructions. Preserve technical names, code identifiers, ' +
        'file paths, commands, and user intent. Do not invent facts or add explanation.',
    },
    {
      role: 'user',
      content:
        `${context}` +
        '\n\nRaw transcript:\n' +
        rawTranscript,
    },
  ]
}

function formatContext(context?: RecentContext): string {
  if (!context) return 'Recent context: none.'
  const lines = ['Recent context:']
  if (context.target) lines.push(`Target: ${context.target}`)
  if (context.precedingText) lines.push(`Existing composer text:\n${context.precedingText}`)
  if (context.selectedText) lines.push(`Selected text:\n${context.selectedText}`)
  if (context.projectHints?.length) {
    lines.push(`Project hints:\n${context.projectHints.map(hint => `- ${hint}`).join('\n')}`)
  }
  if (context.recentMessages?.length) {
    lines.push('Recent messages:')
    for (const message of context.recentMessages.slice(-8)) {
      lines.push(`${message.role}: ${message.text}`)
    }
  }
  return lines.join('\n')
}
