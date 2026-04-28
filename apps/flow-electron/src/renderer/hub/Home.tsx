import { useCallback, useMemo, useState } from 'react'
import { stripSttTag, wrapWithSttTag } from 'agent-voice-dictation'

import type { AppSettings, DictationRecord } from '../../preload/index'
import { formatBindingForDisplay } from '../../shared/hotkeyBinding'

type Props = {
  settings: AppSettings | null
  recents: DictationRecord[]
  onChanged: () => Promise<void> | void
  onOpenSettings: () => void
}

// Home is the default page. It tells the user how to dictate, what
// provider they're on, and shows the local recents list. Nothing else.
//
// We deliberately do NOT show a "record" button here. Recording is
// triggered globally via the hotkey (or by tapping the Status pill in
// hands-free mode). Putting a record button on this page would imply
// the Hub is the place you go to dictate, which it isn't — the whole
// point of this app is to dictate INTO another app.

export function Home({ settings, recents, onChanged, onOpenSettings }: Props) {
  const hotkeyText = settings?.hotkey ?? '—'
  const provider = settings?.sttProvider ?? 'assemblyai'
  const polish = settings?.polishEnabled ? settings.openrouterModel : 'off'
  const stats = useMemo(() => calculateStats(recents), [recents])

  return (
    <div style={pageStyle}>
      <Hero hotkey={hotkeyText} provider={provider} polish={polish} onOpenSettings={onOpenSettings} />
      <StatsPanel stats={stats} />
      <RecentList
        recents={recents}
        insertSttTag={settings?.insertSttTag ?? false}
        onChanged={onChanged}
      />
    </div>
  )
}

function Hero({
  hotkey,
  provider,
  polish,
  onOpenSettings,
}: {
  hotkey: string
  provider: string
  polish: string
  onOpenSettings: () => void
}) {
  return (
    <section style={heroStyle}>
      <div style={heroTopStyle}>
        <div>
          <div style={heroEyebrowStyle}>Dictation ready</div>
          <h1 style={heroHeadlineStyle}>Hold {fmtAccelerator(hotkey)}</h1>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onOpenSettings}>
          Settings
        </button>
      </div>
      <p style={heroSubtextStyle}>
        Speak into any focused text field. The text is streamed, cleaned only when enabled,
        and pasted back at the cursor.
      </p>
      <div style={heroChipsStyle}>
        <Chip label="Speech" value={provider} />
        <Chip label="Polish" value={polish} />
      </div>
    </section>
  )
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span style={chipStyle}>
      <span style={{ color: 'var(--ink-mute)' }}>{label}</span>
      <span style={{ color: 'var(--ink)', fontFamily: 'var(--font-mono)' }}>{value}</span>
    </span>
  )
}

type DictationStats = {
  sessions: number
  words: number
  averageWpm: number
  totalAudioMs: number
}

function StatsPanel({ stats }: { stats: DictationStats }) {
  const wpmWidth = `${Math.min(100, Math.round((stats.averageWpm / 180) * 100))}%`

  return (
    <section style={statsPanelStyle}>
      <div style={statsHeaderStyle}>
        <h2 style={sectionHeadingStyle}>Stats</h2>
        <span style={statsRangeStyle}>local recents</span>
      </div>
      <div style={statsGridStyle}>
        <StatBlock label="Sessions" value={fmtNumber(stats.sessions)} />
        <StatBlock label="Words" value={fmtNumber(stats.words)} />
        <div style={statBlockStyle}>
          <div style={statLabelStyle}>Words/min</div>
          <div style={statValueStyle}>{stats.averageWpm ? Math.round(stats.averageWpm) : '—'}</div>
          <div style={wpmTrackStyle}>
            <div style={{ ...wpmFillStyle, width: wpmWidth }} />
          </div>
        </div>
      </div>
    </section>
  )
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div style={statBlockStyle}>
      <div style={statLabelStyle}>{label}</div>
      <div style={statValueStyle}>{value}</div>
    </div>
  )
}

function RecentList({
  recents,
  insertSttTag,
  onChanged,
}: {
  recents: DictationRecord[]
  insertSttTag: boolean
  onChanged: () => Promise<void> | void
}) {
  if (recents.length === 0) {
    return (
      <section style={listSectionStyle}>
        <h2 style={sectionHeadingStyle}>Recents</h2>
        <p style={emptyStyle}>Your recent dictations will appear here.</p>
      </section>
    )
  }

  return (
    <section style={listSectionStyle}>
      <h2 style={sectionHeadingStyle}>Recents</h2>
      <ul style={listStyle}>
        {recents.map((record, index) => (
          <RecentRow
            key={record.id}
            record={record}
            index={index}
            insertSttTag={insertSttTag}
            onChanged={onChanged}
          />
        ))}
      </ul>
    </section>
  )
}

function RecentRow({
  record,
  index,
  insertSttTag,
  onChanged,
}: {
  record: DictationRecord
  index: number
  insertSttTag: boolean
  onChanged: () => Promise<void> | void
}) {
  const [expanded, setExpanded] = useState(false)
  const text = displayTranscriptText(record)
  const preview = useMemo(() => {
    if (text.length <= 100) return text
    return text.slice(0, 100) + '…'
  }, [text])

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(insertSttTag ? wrapWithSttTag(text) : text)
  }, [insertSttTag, text])

  const remove = useCallback(async () => {
    await window.flow.recents.delete(record.id)
    await onChanged()
  }, [record.id, onChanged])

  return (
    <li style={{ ...rowStyle, animationDelay: `${Math.min(index * 18, 140)}ms` }}>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        style={rowToggleStyle}
        aria-expanded={expanded}
      >
        <span style={rowTimeStyle}>{fmtTime(record.ts)}</span>
        <span style={rowProviderStyle}>{record.provider}</span>
        <span style={rowDurationStyle}>{Math.round(record.durationMs)}ms</span>
        <span style={rowPreviewStyle}>{preview}</span>
      </button>
      {expanded && (
        <div style={rowExpandedStyle}>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{text}</p>
          <div style={rowActionsStyle}>
            <button type="button" className="btn" onClick={copy}>Copy</button>
            <button type="button" className="btn btn-ghost" onClick={remove}>Delete</button>
          </div>
        </div>
      )}
    </li>
  )
}

function fmtAccelerator(value: string): string {
  return formatBindingForDisplay(value)
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function calculateStats(recents: DictationRecord[]): DictationStats {
  const words = recents.reduce((sum, record) => {
    return sum + countWords(displayTranscriptText(record))
  }, 0)
  let wpmWords = 0
  let totalAudioMs = 0
  for (const record of recents) {
    const recordWords = countWords(displayTranscriptText(record))
    const audioMs = normalizedAudioDurationMs(record, recordWords)
    if (audioMs <= 0) continue
    wpmWords += recordWords
    totalAudioMs += audioMs
  }

  // WPM is based on provider-reported audio duration when available, not total
  // wall-clock pipeline duration. The latter includes network/upload/paste time
  // and would punish slower providers instead of describing how fast the user
  // actually spoke.
  const averageWpm = totalAudioMs > 0 ? wpmWords / (totalAudioMs / 60_000) : 0
  return {
    sessions: recents.length,
    words,
    averageWpm,
    totalAudioMs,
  }
}

function normalizedAudioDurationMs(record: DictationRecord, words: number): number {
  const audioMs = typeof record.audioDurationMs === 'number' ? record.audioDurationMs : 0
  if (!audioMs) return 0

  // Early AssemblyAI records stored `audio_duration` as milliseconds even
  // though the provider returns seconds. That made 17 seconds look like 17ms
  // and inflated WPM into nonsense. Keep the UI resilient for existing recents:
  // if "audio" is implausibly tiny compared with the full pipeline duration,
  // treat that value as seconds from the legacy bug.
  if (audioMs < 1000 && record.durationMs > 1000 && record.durationMs / audioMs > 100) {
    const repaired = audioMs * 1000
    return isPlausibleSpeechRate(words, repaired) ? repaired : 0
  }
  return isPlausibleSpeechRate(words, audioMs) ? audioMs : 0
}

function isPlausibleSpeechRate(words: number, audioMs: number): boolean {
  if (words <= 0 || audioMs < 400) return false
  const wpm = words / (audioMs / 60_000)

  // Human speech can be fast, but 1000+ WPM means the duration metadata is
  // corrupt or came from our early unit bug. Do not let one bad record poison
  // the dashboard; keep the transcript in history, just exclude it from WPM.
  return wpm > 20 && wpm < 420
}

function displayTranscriptText(record: DictationRecord): string {
  // The history is a transcript history, not a composer-output history. Older
  // builds briefly persisted `finalText`, which could include the STT wrapper.
  // Strip that legacy wrapper for display/stats, and only re-add it when the
  // user explicitly copies from history with the setting enabled. Wrapper
  // grammar lives in the package so we cannot drift from what main writes.
  return stripSttTag(record.polished ?? record.raw)
}

function countWords(text: string): number {
  return text.trim().match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g)?.length ?? 0
}

function fmtNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}

const pageStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 26,
  maxWidth: 860,
}

const heroStyle: React.CSSProperties = {
  position: 'relative',
  background:
    'linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.018)), var(--surface)',
  border: '1px solid var(--border-soft)',
  borderRadius: 12,
  padding: '22px 24px 20px',
  boxShadow: 'var(--shadow-card)',
  overflow: 'hidden',
}

const heroTopStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 18,
}

const heroEyebrowStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--ink-mute)',
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  marginBottom: 7,
}

const heroHeadlineStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 22,
  fontWeight: 600,
  color: 'var(--ink)',
  letterSpacing: 0,
}

const heroSubtextStyle: React.CSSProperties = {
  margin: '12px 0 18px',
  color: 'var(--ink-dim)',
  fontSize: 13,
  maxWidth: 620,
}

const heroChipsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
}

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  background: 'rgba(255,255,255,0.035)',
  border: '1px solid var(--border-soft)',
  borderRadius: 8,
  fontSize: 11,
}

const statsPanelStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.025)',
  border: '1px solid var(--border-soft)',
  borderRadius: 12,
  padding: '15px 16px 16px',
  boxShadow: 'var(--shadow-card)',
}

const statsHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 12,
}

const statsRangeStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10.5,
  color: 'var(--ink-mute)',
  textTransform: 'uppercase',
  letterSpacing: 0.6,
}

const statsGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 10,
}

const statBlockStyle: React.CSSProperties = {
  minHeight: 76,
  border: '1px solid var(--border-soft)',
  background: 'rgba(17,21,27,0.72)',
  borderRadius: 10,
  padding: '12px 13px',
}

const statLabelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10.5,
  color: 'var(--ink-mute)',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
}

const statValueStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 23,
  lineHeight: 1,
  fontWeight: 600,
  color: 'var(--ink)',
  letterSpacing: 0,
}

const wpmTrackStyle: React.CSSProperties = {
  height: 4,
  marginTop: 12,
  borderRadius: 999,
  background: 'rgba(255,255,255,0.075)',
  overflow: 'hidden',
}

const wpmFillStyle: React.CSSProperties = {
  height: '100%',
  borderRadius: 999,
  background: 'var(--accent)',
  transition: 'width var(--motion-med) var(--ease-out)',
}

const listSectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

const sectionHeadingStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--ink-dim)',
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  fontFamily: 'var(--font-mono)',
}

const emptyStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--ink-mute)',
  padding: '16px 0',
}

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  background: 'rgba(255,255,255,0.025)',
  border: '1px solid var(--border-soft)',
  borderRadius: 12,
  overflow: 'hidden',
  boxShadow: 'var(--shadow-card)',
}

const rowStyle: React.CSSProperties = {
  background: 'rgba(17,21,27,0.86)',
  borderBottom: '1px solid var(--border-soft)',
  animation: 'app-enter 180ms var(--ease-out) both',
}

const rowToggleStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '70px 96px 72px 1fr',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  padding: '11px 14px',
  background: 'transparent',
  border: 'none',
  textAlign: 'left',
  color: 'var(--ink)',
}

const rowTimeStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--ink-mute)',
}

const rowProviderStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--ink-dim)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const rowDurationStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--ink-mute)',
}

const rowPreviewStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: 'var(--ink)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const rowExpandedStyle: React.CSSProperties = {
  padding: '0 18px 16px 192px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  color: 'var(--ink)',
  fontSize: 13,
  lineHeight: 1.55,
}

const rowActionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
}
