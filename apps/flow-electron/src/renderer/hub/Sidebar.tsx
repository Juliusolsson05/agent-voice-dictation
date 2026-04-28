import { useCallback } from 'react'

export type HubView = 'home'

type Props = {
  view: HubView
  onSelect: (view: HubView) => void
  onOpenSettings: () => void
  version: string
}

// Sidebar is intentionally minimal: one page (Home) and one
// modal-trigger (Settings) at the bottom. We mirror Wispr's
// semantic <nav><ul><li><button> structure because it is correct
// HTML, not because we're copying their style — the visual
// treatment is entirely ours.

export function Sidebar({ view, onSelect, onOpenSettings, version }: Props) {
  const selectHome = useCallback(() => onSelect('home'), [onSelect])

  return (
    <aside style={asideStyle}>
      <div style={brandStyle}>
        <span style={brandMarkStyle} />
        <span>Flow</span>
      </div>

      <nav aria-label="Primary" style={navStyle}>
        <ul style={listStyle}>
          <li>
            <button
              type="button"
              onClick={selectHome}
              aria-current={view === 'home' ? 'page' : undefined}
              style={itemStyle(view === 'home')}
            >
              <Dot active={view === 'home'} />
              <span>Home</span>
            </button>
          </li>
        </ul>
      </nav>

      <div style={spacerStyle} />

      <button type="button" onClick={onOpenSettings} style={itemStyle(false)}>
        <Dot active={false} />
        <span>Settings</span>
      </button>

      <div style={versionStyle}>v{version || '0.0.0'}</div>
    </aside>
  )
}

function Dot({ active }: { active: boolean }) {
  // Tiny inline indicator for the active item. Avoids importing an
  // icon library in v1 — every byte we don't ship is a byte we don't
  // have to maintain.
  return (
    <span
      aria-hidden="true"
      style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: active ? 'var(--accent)' : 'var(--border)',
        marginRight: 10,
        flexShrink: 0,
      }}
    />
  )
}

const asideStyle: React.CSSProperties = {
  position: 'relative',
  zIndex: 2,
  display: 'flex',
  flexDirection: 'column',
  background: 'linear-gradient(180deg, rgba(17,21,27,0.96), rgba(12,15,20,0.96))',
  borderRight: '1px solid var(--border-soft)',
  padding: '14px 10px 12px',
  boxShadow: 'inset -1px 0 rgba(255,255,255,0.025)',
  WebkitAppRegion: 'drag', // hiddenInset traffic lights live here
} as React.CSSProperties

const brandStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  letterSpacing: 0.4,
  padding: '40px 10px 18px',
  color: 'var(--ink)',
}

const brandMarkStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: 'var(--accent)',
  boxShadow: '0 0 18px rgba(141,162,255,0.45)',
}

const navStyle: React.CSSProperties = {
  WebkitAppRegion: 'no-drag',
} as React.CSSProperties

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
}

function itemStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid ' + (active ? 'var(--border-soft)' : 'transparent'),
    background: active ? 'rgba(255,255,255,0.045)' : 'transparent',
    color: active ? 'var(--ink)' : 'var(--ink-dim)',
    textAlign: 'left',
    fontSize: 13,
    transition: 'background var(--motion-fast) ease, border-color var(--motion-fast) ease, color var(--motion-fast) ease',
    WebkitAppRegion: 'no-drag',
  } as React.CSSProperties
}

const spacerStyle: React.CSSProperties = { flex: 1 }

const versionStyle: React.CSSProperties = {
  padding: '8px 10px',
  color: 'var(--ink-mute)',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: 0.4,
}
