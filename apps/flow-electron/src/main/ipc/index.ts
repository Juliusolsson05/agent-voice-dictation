import { ipcMain, BrowserWindow, shell, app } from 'electron'

import {
  loadSettings,
  saveSettings,
  resetSettings,
  type AppSettings,
} from '@main/services/settingsStore.js'
import {
  getSecret,
  setSecret,
  clearSecret,
  listConfiguredSecretIds,
} from '@main/secrets/safeStorageStore.js'
import {
  listRecents,
  deleteRecent,
  clearRecents,
} from '@main/services/recentsStore.js'
import {
  cancelStreamingDictation,
  pushStreamingDictationChunk,
  runDictation,
  startStreamingDictation,
  stopStreamingDictation,
} from '@main/services/dictationController.js'
import { registerConfiguredHotkey } from '@main/services/hotkey.js'
import { getStatusWindow, showStatus, hideStatus } from '@main/windows/status.js'

// One central place to wire IPC. We deliberately keep handlers
// thin — each one delegates into a service module so the IPC layer
// is easy to read and reason about. Channel names are prefixed by
// domain (`settings:*`, `secrets:*`, etc.) so future grep is easy.
//
// NOTE on secrets: there is no `secrets:get` endpoint exposed to the
// renderer. Renderer can ask "is a key configured?" but can never
// pull the decrypted value. Dictation runs in main, so keys never
// need to leave the main process.

export function registerIpc(): void {
  // ---- Settings ----
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', async (_e, patch: Partial<AppSettings>) => {
    let next = await saveSettings(patch)
    if (typeof patch.hotkey === 'string') {
      await registerConfiguredHotkey()
      // registerConfiguredHotkey may repair a malformed accelerator
      // back to the default. Return the repaired settings immediately
      // so the Hub does not display a value that main just rejected.
      next = await loadSettings()
    }
    return next
  })
  ipcMain.handle('settings:reset', async () => {
    const next = await resetSettings()
    await registerConfiguredHotkey()
    return next
  })

  // ---- Secrets ----
  // setSecret accepts the plain string from the Settings UI ONCE,
  // immediately encrypts it via safeStorage, and never gives it back.
  ipcMain.handle('secrets:set', async (_e, params: { id: string; value: string }) => {
    if (!params?.id || typeof params.value !== 'string') {
      throw new Error('secrets:set requires { id, value }')
    }
    await setSecret(params.id, params.value)
    return { ok: true }
  })
  ipcMain.handle('secrets:clear', async (_e, params: { id: string }) => {
    if (!params?.id) throw new Error('secrets:clear requires { id }')
    await clearSecret(params.id)
    return { ok: true }
  })
  ipcMain.handle('secrets:list', async () => listConfiguredSecretIds())
  // Convenience: return only whether a specific id is configured.
  // The renderer Settings UI uses this to show "configured" vs
  // "missing" badges next to each provider input.
  ipcMain.handle('secrets:has', async (_e, params: { id: string }) => {
    if (!params?.id) return false
    const value = await getSecret(params.id)
    return Boolean(value)
  })

  // ---- Recents ----
  ipcMain.handle('recents:list', () => listRecents())
  ipcMain.handle('recents:delete', (_e, params: { id: string }) => deleteRecent(params.id))
  ipcMain.handle('recents:clear', () => clearRecents())

  // ---- Dictation ----
  // The renderer ships an ArrayBuffer. We accept it directly via the
  // structured-clone-capable IPC channel (Electron transfers
  // ArrayBuffers efficiently across the boundary).
  ipcMain.handle(
    'dictation:run',
    async (_e, params: { audio: ArrayBuffer; mimeType?: string }) => {
      if (!params?.audio) throw new Error('dictation:run requires audio')
      const opts = params.mimeType
        ? { audio: params.audio, mimeType: params.mimeType }
        : { audio: params.audio }
      return runDictation(opts)
    },
  )
  ipcMain.handle(
    'dictation:stream-start',
    async (_e, params: { mimeType?: string }) => {
      return startStreamingDictation(params?.mimeType)
    },
  )
  ipcMain.on(
    'dictation:stream-chunk',
    (_e, params: { id: string; chunk: ArrayBuffer }) => {
      if (!params?.id || !params.chunk) return
      pushStreamingDictationChunk(params.id, params.chunk)
    },
  )
  ipcMain.handle(
    'dictation:stream-stop',
    async (_e, params: { id: string }) => {
      if (!params?.id) throw new Error('dictation:stream-stop requires id')
      return stopStreamingDictation(params.id)
    },
  )
  ipcMain.handle(
    'dictation:stream-cancel',
    async (_e, params: { id: string }) => {
      if (!params?.id) return
      cancelStreamingDictation(params.id)
    },
  )

  // ---- Status window control ----
  // The renderer of the Hub triggers a "test mic" or hands-free
  // session by asking main to show/hide the indicator window.
  ipcMain.handle('status:show', () => {
    showStatus()
  })
  ipcMain.handle('status:hide', () => {
    hideStatus()
  })

  // ---- Misc ----
  ipcMain.handle('app:open-data-folder', () => {
    void shell.openPath(app.getPath('userData'))
  })
  ipcMain.handle('app:version', () => app.getVersion())
}

// Helper used by the global hotkey handler in main/index.ts to push
// the "user pressed the dictation key" event into whichever window
// is listening (Status pill primarily, Hub for in-app indicators).
export function broadcastDictationEvent(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
  // Status window is hidden by default; broadcasting still reaches it
  // because BrowserWindow.getAllWindows includes hidden windows.
  void getStatusWindow
}
