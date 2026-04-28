import { app, BrowserWindow } from 'electron'

import { createHubWindow, getHubWindow } from '@main/windows/hub.js'
import { createStatusWindow, showStatus, hideStatus } from '@main/windows/status.js'
import { registerIpc, broadcastDictationEvent } from '@main/ipc/index.js'
import {
  configureHotkeyHandler,
  registerConfiguredHotkey,
  unregisterHotkeys,
} from '@main/services/hotkey.js'

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
  configureHotkeyHandler(
    () => {
      showStatus()
      broadcastDictationEvent('hotkey:down')
      if (process.platform !== 'darwin') {
        // Electron globalShortcut has no release event. Non-macOS keeps the
        // old toggle channel until we build a first-party helper there too.
        broadcastDictationEvent('hotkey:fired')
      }
    },
    () => {
      broadcastDictationEvent('hotkey:up')
    },
  )

  registerIpc()

  await createStatusWindow()
  // Status window starts hidden — we only show it when a dictation
  // session begins. Keeping it hidden at boot avoids a flash of pill
  // before the first interaction.
  hideStatus()

  createHubWindow()

  await registerConfiguredHotkey()

  app.on('activate', () => {
    // macOS: clicking the dock icon with no windows open should open
    // the Hub again, mirroring native app behavior.
    if (BrowserWindow.getAllWindows().length === 0) createHubWindow()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  unregisterHotkeys()
})
