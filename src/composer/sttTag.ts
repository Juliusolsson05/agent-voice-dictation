// Composer-output formatting for speech-derived text.
//
// Hosts that paste dictated text into LLM-facing composers (Claude, ChatGPT,
// Cursor, etc.) want the receiving model to know the text came from STT, so
// the model can account for homophones, name spellings, and code-identifier
// errors that a raw transcript will miss. The wrapper tag is small, stable,
// and explicit:
//
//   <stt note="Speech-to-text; may contain transcription mistakes.">
//   <text>
//   </stt>
//
// This is composer-boundary behavior, not provider behavior — the wrapper is
// not stored in dictation history (history holds clean transcripts), and
// providers must never see it (it would just become more text to transcribe
// the next time it round-trips through dictation). Hosts opt in per-paste.
//
// Lives in the package so every consumer (the desktop app today, Agent Code
// tomorrow, anything else later) uses the same exact wrapper string.
// Drift between hosts would defeat the point — a downstream LLM scanning for
// the marker has to see the same shape every time.

export const STT_TAG_NOTE = 'Speech-to-text; may contain transcription mistakes.'

export function wrapWithSttTag(text: string): string {
  return `<stt note="${STT_TAG_NOTE}">\n${text}\n</stt>`
}

// Strip a wrapper that was previously serialized into a stored transcript.
// Earlier builds briefly persisted the wrapped composer output as
// `finalText`; current code stores raw/polished text only, but legacy
// records still need to display cleanly. The regex is intentionally
// permissive about whitespace inside the tag — we accept anything that
// looks like our wrapper, then unwrap it.
export function stripSttTag(text: string): string {
  return text
    .replace(/^<stt\b[^>]*>\s*/i, '')
    .replace(/\s*<\/stt>\s*$/i, '')
}
