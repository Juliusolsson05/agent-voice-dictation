import { contextBridge, ipcRenderer } from 'electron'

import type { AppSettings, SttProviderId } from '@main/services/settingsStore.js'
import type { DictationRecord } from '@main/services/recentsStore.js'
import type { SpeechProviderSupportMap } from 'agent-voice-dictation'

// Preload bridge.
//
// The renderer can never reach Node directly (sandbox-friendly
// contextIsolation). Everything goes through this typed surface.
// All IPC channels are namespaced (`settings:*`, `secrets:*`, ...)
// to keep grep'ing the codebase easy.
//
// Crucial invariant: there is no `secrets.get(id)` exposed here. The
// renderer can only ASK whether a key is set — it cannot retrieve
// the plaintext value. This keeps the encrypted store meaningful.

export type FlowApi = {
  settings: {
    get(): Promise<AppSettings>
    set(patch: Partial<AppSettings>): Promise<AppSettings>
    reset(): Promise<AppSettings>
  }
  secrets: {
    set(id: string, value: string): Promise<{ ok: true }>
    clear(id: string): Promise<{ ok: true }>
    has(id: string): Promise<boolean>
    list(): Promise<string[]>
  }
  providers: {
    support(): Promise<SpeechProviderSupportMap>
  }
  recents: {
    list(): Promise<DictationRecord[]>
    delete(id: string): Promise<DictationRecord[]>
    clear(): Promise<void>
  }
  dictation: {
    run(audio: ArrayBuffer, mimeType?: string): Promise<{
      record: DictationRecord
      pasted: boolean
    }>
    streamStart(mimeType?: string): Promise<{ id: string }>
    streamChunk(id: string, chunk: ArrayBuffer): Promise<{ ok: true }>
    streamStop(id: string): Promise<{
      record: DictationRecord
      pasted: boolean
    }>
    streamCancel(id: string): Promise<void>
  }
  status: {
    show(): Promise<void>
    hide(): Promise<void>
  }
  app: {
    openDataFolder(): Promise<void>
    version(): Promise<string>
  }
  events: {
    onHotkeyFired(handler: () => void): () => void
    onHotkeyDown(handler: () => void): () => void
    onHotkeyUp(handler: () => void): () => void
    onStatusOpening(handler: () => void): () => void
    onStatusClosing(handler: () => void): () => void
  }
}

const api: FlowApi = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: patch => ipcRenderer.invoke('settings:set', patch),
    reset: () => ipcRenderer.invoke('settings:reset'),
  },
  secrets: {
    set: (id, value) => ipcRenderer.invoke('secrets:set', { id, value }),
    clear: id => ipcRenderer.invoke('secrets:clear', { id }),
    has: id => ipcRenderer.invoke('secrets:has', { id }),
    list: () => ipcRenderer.invoke('secrets:list'),
  },
  providers: {
    support: () => ipcRenderer.invoke('providers:support'),
  },
  recents: {
    list: () => ipcRenderer.invoke('recents:list'),
    delete: id => ipcRenderer.invoke('recents:delete', { id }),
    clear: () => ipcRenderer.invoke('recents:clear'),
  },
  dictation: {
    run: (audio, mimeType) =>
      ipcRenderer.invoke('dictation:run', { audio, mimeType }),
    streamStart: mimeType =>
      ipcRenderer.invoke('dictation:stream-start', { mimeType }),
    streamChunk: (id, chunk) =>
      ipcRenderer.invoke('dictation:stream-chunk', { id, chunk }),
    streamStop: id =>
      ipcRenderer.invoke('dictation:stream-stop', { id }),
    streamCancel: id =>
      ipcRenderer.invoke('dictation:stream-cancel', { id }),
  },
  status: {
    show: () => ipcRenderer.invoke('status:show'),
    hide: () => ipcRenderer.invoke('status:hide'),
  },
  app: {
    openDataFolder: () => ipcRenderer.invoke('app:open-data-folder'),
    version: () => ipcRenderer.invoke('app:version'),
  },
  events: {
    onHotkeyFired(handler) {
      const wrapped = () => handler()
      ipcRenderer.on('hotkey:fired', wrapped)
      // Return an unsubscribe so consumers don't leak listeners on
      // tab change / unmount.
      return () => ipcRenderer.off('hotkey:fired', wrapped)
    },
    onHotkeyDown(handler) {
      const wrapped = () => handler()
      ipcRenderer.on('hotkey:down', wrapped)
      return () => ipcRenderer.off('hotkey:down', wrapped)
    },
    onHotkeyUp(handler) {
      const wrapped = () => handler()
      ipcRenderer.on('hotkey:up', wrapped)
      return () => ipcRenderer.off('hotkey:up', wrapped)
    },
    onStatusOpening(handler) {
      const wrapped = () => handler()
      ipcRenderer.on('status:opening', wrapped)
      return () => ipcRenderer.off('status:opening', wrapped)
    },
    onStatusClosing(handler) {
      const wrapped = () => handler()
      ipcRenderer.on('status:closing', wrapped)
      return () => ipcRenderer.off('status:closing', wrapped)
    },
  },
}

contextBridge.exposeInMainWorld('flow', api)

// Re-export types so the renderer can `import type` from the
// preload module and stay in sync.
export type { AppSettings, SttProviderId, DictationRecord, SpeechProviderSupportMap }
