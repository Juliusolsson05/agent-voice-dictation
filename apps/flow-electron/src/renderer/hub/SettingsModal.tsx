import { useCallback, useEffect, useState } from 'react'

import type { AppSettings, SttProviderId } from '../../preload/index'
import { HotkeyInput } from './HotkeyInput'

type Props = {
  settings: AppSettings
  onClose: () => void
  onChanged: () => Promise<void> | void
}

type Tab = 'dictation' | 'providers' | 'about'

const PROVIDERS: { id: SttProviderId; label: string; secretId: string }[] = [
  { id: 'assemblyai', label: 'AssemblyAI', secretId: 'stt.assemblyai' },
  { id: 'deepgram',   label: 'Deepgram',    secretId: 'stt.deepgram' },
  { id: 'openai',     label: 'OpenAI',      secretId: 'stt.openai' },
  { id: 'gladia',     label: 'Gladia',      secretId: 'stt.gladia' },
  { id: 'elevenlabs', label: 'ElevenLabs',  secretId: 'stt.elevenlabs' },
]

// Settings is a modal because it covers the entire usable surface of
// the Hub anyway. Tabs: Dictation, Providers, About. Three tabs, no
// account section, no team, no billing, no data-and-privacy export
// flow. We strip everything that isn't operationally required.

export function SettingsModal({ settings, onClose, onChanged }: Props) {
  const [tab, setTab] = useState<Tab>('dictation')

  // Esc closes — match the rest of the app's modal convention.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const update = useCallback(
    async (patch: Partial<AppSettings>) => {
      await window.flow.settings.set(patch)
      await onChanged()
    },
    [onChanged],
  )

  return (
    <div style={overlayStyle} onMouseDown={onClose}>
      <div style={panelStyle} onMouseDown={e => e.stopPropagation()}>
        <header style={headerStyle}>
          <div style={headerTitleStyle}>Settings</div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        </header>

        <div style={bodyStyle}>
          <nav style={tabsStyle}>
            <TabButton active={tab === 'dictation'} onClick={() => setTab('dictation')}>Dictation</TabButton>
            <TabButton active={tab === 'providers'} onClick={() => setTab('providers')}>Providers</TabButton>
            <TabButton active={tab === 'about'} onClick={() => setTab('about')}>About</TabButton>
          </nav>

          <div style={paneStyle}>
            {tab === 'dictation' && <DictationTab settings={settings} update={update} />}
            {tab === 'providers' && <ProvidersTab settings={settings} update={update} />}
            {tab === 'about' && <AboutTab onChanged={onChanged} />}
          </div>
        </div>
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onPointerDown={e => {
        // These buttons live inside a modal whose backdrop closes on
        // outside interaction, and the Electron window uses draggable
        // hidden-titlebar regions elsewhere. Running the tab switch on
        // pointerdown and stopping propagation makes the settings nav
        // independent of click synthesis, backdrop handling, and any
        // future drag-region tweaks. If this is only `onClick`, a
        // swallowed mouseup/click makes the tab feel dead even though
        // the button visually exists.
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }}
      onClick={e => {
        e.preventDefault()
        e.stopPropagation()
      }}
      style={{
        display: 'block',
        width: '100%',
        padding: '8px 11px',
        textAlign: 'left',
        border: '1px solid ' + (active ? 'var(--border-soft)' : 'transparent'),
        borderRadius: 8,
        background: active ? 'rgba(255,255,255,0.045)' : 'transparent',
        color: active ? 'var(--ink)' : 'var(--ink-dim)',
        fontSize: 12,
        transition: 'background var(--motion-fast) ease, border-color var(--motion-fast) ease, color var(--motion-fast) ease',
        WebkitAppRegion: 'no-drag',
      }}
    >
      {children}
    </button>
  )
}

// ---------- Dictation tab ----------

function DictationTab({
  settings,
  update,
}: {
  settings: AppSettings
  update: (patch: Partial<AppSettings>) => Promise<void>
}) {
  return (
    <Section title="General">
      <Row label="Hotkey" hint="Click and press your combo. Esc cancels.">
        <HotkeyInput
          value={settings.hotkey}
          onChange={next => void update({ hotkey: next })}
          placeholder="Click to set hotkey"
        />
      </Row>
      <Toggle
        label="Auto-paste at cursor"
        hint="Paste the final text into the focused app on macOS."
        value={settings.autoPasteAtCursor}
        onChange={v => void update({ autoPasteAtCursor: v })}
      />
      <Toggle
        label="Hands-free indicator"
        hint="Show cancel/stop buttons in the status pill."
        value={settings.handsFreeMode}
        onChange={v => void update({ handsFreeMode: v })}
      />
      <Toggle
        label="Insert STT tag"
        hint="Wrap pasted text so LLMs know it came from speech-to-text."
        value={settings.insertSttTag}
        onChange={v => void update({ insertSttTag: v })}
      />
      <Toggle
        label="Play sounds"
        hint="Subtle start/stop sounds."
        value={settings.playSounds}
        onChange={v => void update({ playSounds: v })}
      />
    </Section>
  )
}

// ---------- Providers tab ----------

function ProvidersTab({
  settings,
  update,
}: {
  settings: AppSettings
  update: (patch: Partial<AppSettings>) => Promise<void>
}) {
  return (
    <>
      <Section title="Speech to text">
        <Row label="Provider">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {PROVIDERS.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => void update({ sttProvider: p.id })}
                style={pillStyle(settings.sttProvider === p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </Row>
        {PROVIDERS.map(p => (
          <SecretRow
            key={p.id}
            label={`${p.label} API key`}
            secretId={p.secretId}
          />
        ))}
      </Section>

      <Section title="Polish (OpenRouter)">
        <Toggle
          label="Polish transcripts with an LLM"
          hint="Cleans filler words and applies inline corrections."
          value={settings.polishEnabled}
          onChange={v => void update({ polishEnabled: v })}
        />
        <Row label="Model" hint="Any OpenRouter model id.">
          <input
            className="input"
            value={settings.openrouterModel}
            onChange={e => void update({ openrouterModel: e.target.value })}
            placeholder="deepseek/deepseek-v4-flash"
          />
        </Row>
        <SecretRow label="OpenRouter API key" secretId="openrouter" />
      </Section>
    </>
  )
}

function SecretRow({ label, secretId }: { label: string; secretId: string }) {
  // Renderer never sees the stored value. We only ask "is it set?"
  // and provide a Save / Clear UI. The plaintext is sent ONCE on
  // save and immediately encrypted in main.
  const [configured, setConfigured] = useState<boolean>(false)
  const [draft, setDraft] = useState<string>('')
  const [busy, setBusy] = useState<boolean>(false)

  useEffect(() => {
    let alive = true
    void window.flow.secrets.has(secretId).then(v => {
      if (alive) setConfigured(v)
    })
    return () => {
      alive = false
    }
  }, [secretId])

  const save = useCallback(async () => {
    if (!draft.trim()) return
    setBusy(true)
    try {
      await window.flow.secrets.set(secretId, draft.trim())
      setConfigured(true)
      setDraft('')
    } finally {
      setBusy(false)
    }
  }, [draft, secretId])

  const clear = useCallback(async () => {
    setBusy(true)
    try {
      await window.flow.secrets.clear(secretId)
      setConfigured(false)
    } finally {
      setBusy(false)
    }
  }, [secretId])

  return (
    <Row label={label} hint={configured ? 'Configured.' : 'Not set.'}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          className="input"
          type="password"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={configured ? '••••••••' : 'paste key'}
          disabled={busy}
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={busy || !draft.trim()}
        >
          Save
        </button>
        {configured && (
          <button type="button" className="btn btn-danger" onClick={clear} disabled={busy}>
            Clear
          </button>
        )}
      </div>
    </Row>
  )
}

// ---------- About tab ----------

function AboutTab({ onChanged }: { onChanged: () => Promise<void> | void }) {
  const [version, setVersion] = useState('')
  useEffect(() => {
    void window.flow.app.version().then(setVersion)
  }, [])

  const reset = useCallback(async () => {
    await window.flow.settings.reset()
    await onChanged()
  }, [onChanged])

  const open = useCallback(async () => {
    await window.flow.app.openDataFolder()
  }, [])

  return (
    <Section title="About">
      <Row label="Version">
        <code style={{ fontFamily: 'var(--font-mono)' }}>{version || '—'}</code>
      </Row>
      <Row label="Data folder" hint="Settings, recents, and encrypted secrets live here.">
        <button type="button" className="btn" onClick={open}>Open data folder</button>
      </Row>
      <Row label="Reset" hint="Restore default settings. Does not clear API keys.">
        <button type="button" className="btn btn-danger" onClick={reset}>Reset settings</button>
      </Row>
    </Section>
  )
}

// ---------- Layout primitives ----------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h3 style={{
        margin: '0 0 12px',
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        color: 'var(--ink-mute)',
        fontFamily: 'var(--font-mono)',
      }}>{title}</h3>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        border: '1px solid var(--border-soft)',
        borderRadius: 12,
        overflow: 'hidden',
        background: 'rgba(255,255,255,0.02)',
      }}>
        {children}
      </div>
    </section>
  )
}

function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '180px 1fr',
      gap: 16,
      alignItems: 'start',
      padding: '13px 14px',
      borderBottom: '1px solid var(--border-soft)',
      background: 'rgba(17,21,27,0.58)',
    }}>
      <div>
        <div style={{ color: 'var(--ink)', fontSize: 12.5 }}>{label}</div>
        {hint && <div style={{ color: 'var(--ink-mute)', fontSize: 11, marginTop: 2 }}>{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  )
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint?: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <Row label={label} hint={hint}>
      <button
        type="button"
        onClick={() => onChange(!value)}
        aria-pressed={value}
        style={{
          width: 38,
          height: 22,
          borderRadius: 999,
          border: '1px solid ' + (value ? 'var(--accent)' : 'var(--border)'),
          background: value ? 'var(--accent)' : 'var(--surface-2)',
          padding: 2,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: value ? 'flex-end' : 'flex-start',
          transition: 'background 120ms ease, border-color 120ms ease, justify-content 120ms ease',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'block',
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: value ? 'var(--accent-fg)' : 'var(--ink-dim)',
          }}
        />
      </button>
    </Row>
  )
}

function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: '6px 12px',
    fontSize: 12,
    borderRadius: 8,
    border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'),
    background: active ? 'var(--accent)' : 'rgba(255,255,255,0.025)',
    color: active ? 'var(--accent-fg)' : 'var(--ink-dim)',
    transition: 'background var(--motion-fast) ease, border-color var(--motion-fast) ease, color var(--motion-fast) ease',
  }
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(5, 7, 10, 0.58)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
}

const panelStyle: React.CSSProperties = {
  width: 760,
  maxHeight: '82vh',
  background: 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.012)), var(--surface)',
  border: '1px solid var(--border-soft)',
  borderRadius: 14,
  boxShadow: 'var(--shadow-modal)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  animation: 'modal-enter var(--motion-med) var(--ease-out)',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 16px',
  borderBottom: '1px solid var(--border-soft)',
  background: 'rgba(255,255,255,0.018)',
}

const headerTitleStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 13,
  color: 'var(--ink)',
}

const bodyStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '180px 1fr',
  flex: 1,
  minHeight: 0,
}

const tabsStyle: React.CSSProperties = {
  borderRight: '1px solid var(--border-soft)',
  padding: '14px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  background: 'rgba(9,11,15,0.26)',
}

const paneStyle: React.CSSProperties = {
  padding: '20px 24px',
  overflow: 'auto',
  background:
    'linear-gradient(135deg, rgba(141,162,255,0.035), transparent 34%), var(--surface-2)',
}
