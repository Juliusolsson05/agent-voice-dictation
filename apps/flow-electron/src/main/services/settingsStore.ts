import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isSpeechProviderSelectable } from 'agent-voice-dictation'

import { DEFAULT_HOTKEY_BINDING } from '../../shared/hotkeyBinding.js'

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
  language: string               // V1 is intentionally English-only.
  autoPasteAtCursor: boolean
  playSounds: boolean
  handsFreeMode: boolean         // governs the Status pill UI
  insertSttTag: boolean          // wraps pasted output for LLM-facing composers
  integrationHotkeyYield: Record<string, boolean>

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
  // settings file and make future migrations painful. Constant lives
  // in shared/hotkeyBinding so the renderer's "Default" button can
  // reference the same value without going through IPC.
  hotkey: DEFAULT_HOTKEY_BINDING,
  microphoneDeviceId: null,
  language: 'en',
  autoPasteAtCursor: true,
  // Default ON because the open/close chirps are part of the dictation UX,
  // not a power-user opt-in: a press without an audible confirmation feels
  // like the app missed the hotkey, even when the pill appears. The
  // Settings toggle still exists for users who specifically want silence.
  playSounds: true,
  handsFreeMode: false,
  insertSttTag: false,
  integrationHotkeyYield: {},
  sttProvider: 'deepgram',
  polishEnabled: false,
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
  const coerced: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...partial,
    v: 1,
    hotkey: migrateLegacyHotkey(partial.hotkey ?? DEFAULT_SETTINGS.hotkey),
    // Provider selection is gated by the package-level support registry, not
    // by whether a client file happens to exist. We have unverified clients in
    // the repo for future work, but old settings files must not keep selecting
    // them after the product marks them unavailable. Deepgram remains the
    // fallback because it is the active low-latency path.
    sttProvider: isSupportedSttProvider(partial.sttProvider) ? partial.sttProvider : 'deepgram',
    // Force all existing settings files back to English. We previously allowed
    // free-form BCP-47 codes, which let an old `sv` value reach AssemblyAI and
    // fail Universal-3 Pro with "sv is not currently supported". V1 is an
    // English dictation app until we deliberately add multilingual fallback
    // routing, so the settings file must not be the source of truth for
    // language selection.
    language: 'en',
    integrationHotkeyYield:
      partial.integrationHotkeyYield && typeof partial.integrationHotkeyYield === 'object'
        ? Object.fromEntries(
            Object.entries(partial.integrationHotkeyYield)
              .filter(([key, value]) => key.trim() && typeof value === 'boolean'),
          )
        : {},
    statusWindowPosition:
      partial.statusWindowPosition && typeof partial.statusWindowPosition === 'object'
        ? {
            x: Number((partial.statusWindowPosition as { x: number }).x) || 0,
            y: Number((partial.statusWindowPosition as { y: number }).y) || 0,
          }
        : null,
  }
  return coerced
}

function isSupportedSttProvider(value: unknown): value is SttProviderId {
  return typeof value === 'string'
    && ['assemblyai', 'deepgram', 'openai', 'gladia', 'elevenlabs'].includes(value)
    && isSpeechProviderSelectable(value as SttProviderId)
}

// One-shot migration for the bracket-key rename. Earlier builds stored
// "SQUARE BRACKET OPEN" / "SQUARE BRACKET CLOSE" in the hotkey string,
// and the names were swapped relative to the actual key the user chose:
// the macOS keycode 0x1E (`]`, kVK_ANSI_RightBracket) was labeled OPEN,
// and 0x21 (`[`, kVK_ANSI_LeftBracket) was labeled CLOSE. Rewrite so the
// stored value matches the new physical-position vocabulary; the helper
// no longer accepts the old names.
function migrateLegacyHotkey(value: string): string {
  return value
    .replace(/\bSQUARE BRACKET OPEN\b/g, 'BRACKET_RIGHT')
    .replace(/\bSQUARE BRACKET CLOSE\b/g, 'BRACKET_LEFT')
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
