import { app, globalShortcut, BrowserWindow } from 'electron'

import { createHubWindow, getHubWindow } from '@main/windows/hub.js'
import { createStatusWindow, showStatus, hideStatus } from '@main/windows/status.js'
import { registerIpc, broadcastDictationEvent } from '@main/ipc/index.js'
import { loadSettings } from '@main/services/settingsStore.js'

// Main entry. Responsibilities:
//   1. Single-instance lock so we don't spawn duplicate hubs.
//   2. Register IPC.
//   3. Create both windows.
//   4. Wire the global dictation hotkey.
//   5. Tear down hotkeys on quit.
//
// This file deliberately stays small. Anything domain-specific lives
// in services/ or windows/ — keeping main entry thin makes it easy
// to see the lifecycle at a glance.

const lock = app.requestSingleInstanceLock()
if (!lock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const hub = getHubWindow()
    if (hub) {
      if (hub.isMinimized()) hub.restore()
      hub.show()
      hub.focus()
    }
  })
  void app.whenReady().then(start)
}

async function start(): Promise<void> {
  registerIpc()

  await createStatusWindow()
  // Status window starts hidden — we only show it when a dictation
  // session begins. Keeping it hidden at boot avoids a flash of pill
  // before the first interaction.
  hideStatus()

  createHubWindow()

  await wireGlobalHotkey()

  app.on('activate', () => {
    // macOS: clicking the dock icon with no windows open should open
    // the Hub again, mirroring native app behavior.
    if (BrowserWindow.getAllWindows().length === 0) createHubWindow()
  })
}

async function wireGlobalHotkey(): Promise<void> {
  const settings = await loadSettings()
  // We register a press/release-like flow using two events:
  //   - the accelerator pressed: signal "begin recording"
  //   - the accelerator released: signal "end recording"
  //
  // Electron's globalShortcut API only fires once per press, so we
  // rely on the renderer to interpret a single fire as a toggle in
  // hands-free mode and as press-to-talk start in hold mode. For
  // hold-to-talk on macOS we will need to upgrade to a per-keystroke
  // listener via a native module — not in v1.
  //
  // For now: every hotkey press toggles the Status pill and
  // broadcasts a `hotkey:fired` event for the Status renderer to
  // start/stop recording.
  const ok = globalShortcut.register(settings.hotkey, () => {
    showStatus()
    broadcastDictationEvent('hotkey:fired')
  })
  if (!ok) {
    // eslint-disable-next-line no-console
    console.warn(`[hotkey] failed to register accelerator "${settings.hotkey}"`)
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
