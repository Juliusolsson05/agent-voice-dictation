import { useCallback, useEffect, useState } from 'react'

import type { AppSettings, DictationRecord } from '../../preload/index'
import { Sidebar, type HubView } from './Sidebar'
import { Home } from './Home'
import { SettingsModal } from './SettingsModal'

// The Hub is a tiny SPA: sidebar + content. Only Home has its own
// page; Settings opens as a modal so the user always returns to the
// same place when they close it. This matches the Wispr behavior
// you flagged in the screenshots without copying their visual chrome.

export function App() {
  const [view, setView] = useState<HubView>('home')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [recents, setRecents] = useState<DictationRecord[]>([])
  const [version, setVersion] = useState<string>('')

  const refreshSettings = useCallback(async () => {
    const s = await window.flow.settings.get()
    setSettings(s)
  }, [])

  const refreshRecents = useCallback(async () => {
    const list = await window.flow.recents.list()
    setRecents(list)
  }, [])

  useEffect(() => {
    void refreshSettings()
    void refreshRecents()
    void window.flow.app.version().then(setVersion)
  }, [refreshSettings, refreshRecents])

  // The Sidebar's "Settings" button opens the modal — Settings is not
  // a separate page in the content area, so view stays on whatever
  // the user was on. Keeping this in App so both Sidebar and Home
  // can pop the modal without prop-drilling further.
  const openSettings = useCallback(() => setSettingsOpen(true), [])
  const closeSettings = useCallback(() => setSettingsOpen(false), [])

  return (
    <div style={layoutStyle}>
      <div style={lineFieldStyle} aria-hidden="true" />
      <Sidebar
        view={view}
        onSelect={setView}
        onOpenSettings={openSettings}
        version={version}
      />
      <main style={contentStyle}>
        {view === 'home' && (
          <Home
            settings={settings}
            recents={recents}
            onChanged={refreshRecents}
            onOpenSettings={openSettings}
          />
        )}
      </main>
      {settingsOpen && settings && (
        <SettingsModal
          settings={settings}
          onClose={closeSettings}
          onChanged={refreshSettings}
        />
      )}
    </div>
  )
}

const layoutStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '208px 1fr',
  height: '100%',
  position: 'relative',
  overflow: 'hidden',
  background:
    'radial-gradient(circle at 82% 8%, rgba(141,162,255,0.10), transparent 32%), ' +
    'linear-gradient(135deg, var(--bg), var(--bg-soft) 56%, #07090d)',
}

const contentStyle: React.CSSProperties = {
  position: 'relative',
  zIndex: 1,
  overflow: 'auto',
  padding: '58px 56px 52px',
  animation: 'app-enter var(--motion-med) var(--ease-out)',
  // Top inset accounts for hiddenInset traffic lights so content
  // doesn't sit underneath them.
}

const lineFieldStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  opacity: 0.55,
  backgroundImage:
    'linear-gradient(120deg, transparent 0 68%, rgba(255,255,255,0.045) 68.15%, transparent 68.5%), ' +
    'linear-gradient(120deg, transparent 0 74%, rgba(141,162,255,0.035) 74.15%, transparent 74.45%), ' +
    'linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px)',
  backgroundSize: '340px 340px, 520px 520px, 56px 56px',
  maskImage: 'radial-gradient(circle at 84% 8%, black, transparent 47%)',
  WebkitMaskImage: 'radial-gradient(circle at 84% 8%, black, transparent 47%)',
}
