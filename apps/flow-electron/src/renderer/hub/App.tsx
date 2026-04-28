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
  gridTemplateColumns: '220px 1fr',
  height: '100%',
}

const contentStyle: React.CSSProperties = {
  overflow: 'auto',
  padding: '60px 48px 48px',
  // Top inset accounts for hiddenInset traffic lights so content
  // doesn't sit underneath them.
}
