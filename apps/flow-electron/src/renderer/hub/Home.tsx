import { useCallback, useMemo, useState } from 'react'

import type { AppSettings, DictationRecord } from '../../preload/index'

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

  return (
    <div style={pageStyle}>
      <Hero hotkey={hotkeyText} provider={provider} polish={polish} onOpenSettings={onOpenSettings} />
      <RecentList recents={recents} onChanged={onChanged} />
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
      <div style={heroEyebrowStyle}>Hold {fmtAccelerator(hotkey)} and speak</div>
      <h1 style={heroHeadlineStyle}>Press, talk, release.</h1>
      <p style={heroSubtextStyle}>
        Your dictation lands at the cursor in the focused app. Start in any
        text field — the indicator shows up automatically.
      </p>
      <div style={heroChipsStyle}>
        <Chip label="Speech" value={provider} />
        <Chip label="Polish" value={polish} />
        <button type="button" className="btn btn-ghost" onClick={onOpenSettings}>
          Settings
        </button>
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

function RecentList({
  recents,
  onChanged,
}: {
  recents: DictationRecord[]
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
        {recents.map(record => (
          <RecentRow key={record.id} record={record} onChanged={onChanged} />
        ))}
      </ul>
    </section>
  )
}

function RecentRow({
  record,
  onChanged,
}: {
  record: DictationRecord
  onChanged: () => Promise<void> | void
}) {
  const [expanded, setExpanded] = useState(false)
  const text = record.polished ?? record.raw
  const preview = useMemo(() => {
    if (text.length <= 100) return text
    return text.slice(0, 100) + '…'
  }, [text])

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(text)
  }, [text])

  const remove = useCallback(async () => {
    await window.flow.recents.delete(record.id)
    await onChanged()
  }, [record.id, onChanged])

  return (
    <li style={rowStyle}>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        style={rowToggleStyle}
        aria-expanded={expanded}
      >
        <span style={rowTimeStyle}>{fmtTime(record.ts)}</span>
        <span style={rowProviderStyle}>{record.provider}{record.model ? ' · ' + record.model : ''}</span>
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
  // Show ⌥⌘ etc instead of "Alt+Cmd" in the hero. Pure cosmetic.
  return value
    .replace(/CommandOrControl/g, '⌘')
    .replace(/Cmd/g, '⌘')
    .replace(/Ctrl/g, '⌃')
    .replace(/Alt/g, '⌥')
    .replace(/Shift/g, '⇧')
    .replace(/\+/g, '')
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

const pageStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 28,
  maxWidth: 720,
}

const heroStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border-soft)',
  borderRadius: 'var(--radius-lg)',
  padding: '28px 28px 22px',
  boxShadow: 'var(--shadow-card)',
}

const heroEyebrowStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--ink-mute)',
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  marginBottom: 8,
}

const heroHeadlineStyle: React.CSSProperties = {
  margin: '0 0 6px',
  fontSize: 24,
  fontWeight: 600,
  color: 'var(--ink)',
}

const heroSubtextStyle: React.CSSProperties = {
  margin: '0 0 18px',
  color: 'var(--ink-dim)',
  fontSize: 13,
  maxWidth: 540,
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
  background: 'var(--surface-2)',
  border: '1px solid var(--border-soft)',
  borderRadius: 'var(--radius-pill)',
  fontSize: 11,
}

const listSectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

const sectionHeadingStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--ink-dim)',
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  fontFamily: 'var(--font-mono)',
}

const emptyStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--ink-mute)',
  padding: '12px 0',
}

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  background: 'var(--border-soft)',
  borderRadius: 'var(--radius-md)',
  overflow: 'hidden',
}

const rowStyle: React.CSSProperties = {
  background: 'var(--surface)',
}

const rowToggleStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '64px 180px 1fr',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  padding: '10px 14px',
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

const rowPreviewStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: 'var(--ink)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const rowExpandedStyle: React.CSSProperties = {
  padding: '0 14px 14px 90px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  color: 'var(--ink)',
  fontSize: 13,
}

const rowActionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
}
