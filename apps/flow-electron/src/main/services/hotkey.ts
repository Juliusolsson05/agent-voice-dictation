import { globalShortcut } from 'electron'

import { toElectronAccelerator } from '../../shared/hotkeyBinding.js'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '@main/services/settingsStore.js'
import { startMacHotkeyHelper, stopMacHotkeyHelper } from '@main/services/macHotkeyHelper.js'

let onHotkeyFire: (() => void) | null = null

export function configureHotkeyHandler(handler: () => void): void {
  onHotkeyFire = handler
}

export async function registerConfiguredHotkey(): Promise<{
  accelerator: string
  ok: boolean
  fallbackUsed: boolean
}> {
  const settings = await loadSettings()
  const requested = settings.hotkey.trim()
  const fallback = DEFAULT_SETTINGS.hotkey

  globalShortcut.unregisterAll()
  stopMacHotkeyHelper()

  if (!requested) {
    await saveSettings({ hotkey: fallback })
    return registerConfiguredHotkey()
  }

  if (!onHotkeyFire) {
    throw new Error('configureHotkeyHandler must run before registering hotkeys')
  }

  if (process.platform === 'darwin') {
    // On macOS the source of truth is our first-party CGEventTap helper,
    // not Electron's accelerator parser. That is the only path that can
    // represent Fn, bare modifiers, punctuation, and physical-key
    // bindings without silently rewriting what the user chose.
    const ok = await startMacHotkeyHelper(requested, onHotkeyFire)
    return { accelerator: requested, ok, fallbackUsed: false }
  }

  const registered = registerElectronAccelerator(requested, false)
  if (registered.ok) return registered

  await saveSettings({ hotkey: fallback })
  return registerElectronAccelerator(fallback, true)
}

export function unregisterHotkeys(): void {
  globalShortcut.unregisterAll()
  stopMacHotkeyHelper()
}

function registerElectronAccelerator(
  accelerator: string,
  fallbackUsed: boolean,
): { accelerator: string; ok: boolean; fallbackUsed: boolean } {
  if (!onHotkeyFire) {
    throw new Error('configureHotkeyHandler must run before registering hotkeys')
  }

  const electronAccelerator = toElectronAccelerator(accelerator)

  try {
    const ok = globalShortcut.register(electronAccelerator, onHotkeyFire)
    if (!ok) {
      // eslint-disable-next-line no-console
      console.warn(`[hotkey] Electron refused accelerator "${electronAccelerator}"`)
    }
    return { accelerator, ok, fallbackUsed }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[hotkey] invalid Electron accelerator "${electronAccelerator}"`, err)
    return { accelerator, ok: false, fallbackUsed }
  }
}
