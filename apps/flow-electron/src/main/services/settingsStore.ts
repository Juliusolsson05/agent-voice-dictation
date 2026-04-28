import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// Plain settings store. Lives next to secrets.json but UNencrypted on
// purpose: this file holds non-sensitive preferences (selected provider
// id, hotkey string, language). Mixing it with the encrypted secrets
// blob would mean every settings change goes through safeStorage,
// which is wasted work and makes the file unreadable in a text editor
// when debugging the app.
//
// The renderer does NOT read this file directly — it calls IPC. That
// keeps the file path private to main and lets us migrate the format
// without touching renderer code.

export type SttProviderId =
  | 'assemblyai'
  | 'deepgram'
  | 'openai'
  | 'gladia'
  | 'elevenlabs'

export type AppSettings = {
  // Bumped manually whenever the shape changes; coerceSettings handles
  // older values forward without crashing.
  v: 1

  // Dictation tab
  hotkey: string                 // Mac helper binding string; Electron accelerator only off macOS
  microphoneDeviceId: string | null
  language: string | null        // BCP-47 like 'en' or null = auto
  autoPasteAtCursor: boolean
  playSounds: boolean
  handsFreeMode: boolean         // governs the Status pill UI

  // Providers tab
  sttProvider: SttProviderId
  polishEnabled: boolean
  openrouterModel: string

  // Window state — saved on close so the indicator pill returns to
  // where the user dragged it. Hub geometry is left to Electron's
  // own state-keeping for now.
  statusWindowPosition: { x: number; y: number } | null
}

export const DEFAULT_SETTINGS: AppSettings = {
  v: 1,
  // Stored in the same binding vocabulary that the checked-in macOS
  // helper consumes. This is not an Electron accelerator on macOS:
  // Electron cannot represent Fn or modifier-only bindings, so using
  // Electron naming here would put the wrong abstraction in the
  // settings file and make future migrations painful.
  hotkey: 'Option+SPACE',
  microphoneDeviceId: null,
  language: null,
  autoPasteAtCursor: true,
  playSounds: false,
  handsFreeMode: false,
  sttProvider: 'assemblyai',
  polishEnabled: true,
  openrouterModel: 'deepseek/deepseek-v4-flash',
  statusWindowPosition: null,
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function coerceSettings(value: unknown): AppSettings {
  // Defensive merge with defaults. Any field we don't recognize is
  // dropped; any field we expect that is missing falls back to the
  // default. Older versions are upgraded by simply re-running this —
  // there is no migration ladder yet because we are still on v1.
  const partial = (value && typeof value === 'object' ? value : {}) as Partial<AppSettings>
  return {
    ...DEFAULT_SETTINGS,
    ...partial,
    v: 1,
    statusWindowPosition:
      partial.statusWindowPosition && typeof partial.statusWindowPosition === 'object'
        ? {
            x: Number((partial.statusWindowPosition as { x: number }).x) || 0,
            y: Number((partial.statusWindowPosition as { y: number }).y) || 0,
          }
        : null,
  }
}

let cached: AppSettings | null = null

export async function loadSettings(): Promise<AppSettings> {
  if (cached) return cached
  try {
    const raw = await readFile(settingsPath(), 'utf8')
    cached = coerceSettings(JSON.parse(raw))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // eslint-disable-next-line no-console
      console.warn('[settings] failed to read; using defaults:', err)
    }
    cached = { ...DEFAULT_SETTINGS }
  }
  return cached
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await loadSettings()
  const next = coerceSettings({ ...current, ...patch })
  cached = next
  const target = settingsPath()
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, JSON.stringify(next, null, 2), 'utf8')
  return next
}

export async function resetSettings(): Promise<AppSettings> {
  cached = { ...DEFAULT_SETTINGS }
  const target = settingsPath()
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, JSON.stringify(cached, null, 2), 'utf8')
  return cached
}
