import { BrowserWindow, screen } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { loadSettings, saveSettings } from '@main/services/settingsStore.js'

// The Status pill is the small floating dictation indicator. It must:
//   - never steal focus (focusable: false) so dictation works while
//     another app is the keyboard target
//   - stay above all other windows (always-on-top with screen-saver
//     level) so it remains visible during recording
//   - be transparent + frameless so the pill can render with its own
//     rounded shape on top of any background
//   - be draggable by the user, with the position persisted

const __dirname = dirname(fileURLToPath(import.meta.url))

const PILL_WIDTH = 220
const PILL_HEIGHT = 56
const HIDE_ANIMATION_MS = 150

let status: BrowserWindow | null = null
let hideGeneration = 0

export function getStatusWindow(): BrowserWindow | null {
  return status
}

function defaultPosition(): { x: number; y: number } {
  // Bottom-center of the primary display, slightly above the dock.
  // We compute this lazily because screen metrics aren't available
  // until the app is ready.
  const display = screen.getPrimaryDisplay()
  const { workArea } = display
  return {
    x: Math.round(workArea.x + (workArea.width - PILL_WIDTH) / 2),
    y: Math.round(workArea.y + workArea.height - PILL_HEIGHT - 8),
  }
}

export async function createStatusWindow(): Promise<BrowserWindow> {
  if (status && !status.isDestroyed()) return status
  const settings = await loadSettings()
  const pos = settings.statusWindowPosition ?? defaultPosition()

  status = new BrowserWindow({
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    x: pos.x,
    y: pos.y,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // alwaysOnTop with 'screen-saver' level keeps the pill above
    // fullscreen apps like Zoom too — dictation across all
    // foreground contexts is the whole point.
    alwaysOnTop: true,
    // focusable: false is the magic that lets the user keep typing
    // (or hold a hotkey) in another app while the pill is visible.
    focusable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  status.setAlwaysOnTop(true, 'screen-saver')
  // Visible across all macOS Spaces — otherwise switching desktops
  // hides the pill.
  status.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  status.on('move', () => {
    if (!status || status.isDestroyed()) return
    const [x, y] = status.getPosition()
    void saveSettings({ statusWindowPosition: { x, y } })
  })

  status.on('closed', () => {
    status = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void status.loadURL(`${process.env.ELECTRON_RENDERER_URL}/status/index.html`)
  } else {
    void status.loadFile(join(__dirname, '../renderer/status/index.html'))
  }
  return status
}

export function showStatus(): void {
  if (!status || status.isDestroyed()) return
  void applyOverlayMode()
  // Always reassert these at show-time. macOS Spaces/fullscreen window
  // behavior can be surprisingly stateful after displays sleep, apps
  // enter fullscreen, or Mission Control moves windows around. The
  // status pill is not normal app chrome; it is a HUD over the active
  // target app, so every show must re-pin it instead of trusting the
  // constructor state from minutes ago.
  status.setAlwaysOnTop(true, 'screen-saver')
  status.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  status.moveTop()
  status.showInactive()
  hideGeneration += 1
  status.webContents.send('status:opening')
}

export function hideStatus(): void {
  if (!status || status.isDestroyed()) return
  // BrowserWindow.hide() is instant, so the renderer never gets a chance to
  // animate out. The status window is tiny and transparent, which makes an
  // abrupt disappear feel cheap. We let the renderer shrink/fade the pill for
  // one short frame window, then hide the native window. If another hotkey shows
  // the pill during that delay, the visibility guard prevents the stale timer
  // from hiding the new session.
  const generation = hideGeneration
  status.webContents.send('status:closing')
  const target = status
  setTimeout(() => {
    if (hideGeneration === generation && status === target && !target.isDestroyed()) target.hide()
  }, HIDE_ANIMATION_MS)
}

async function applyOverlayMode(): Promise<void> {
  if (!status || status.isDestroyed()) return
  const settings = await loadSettings()
  // Default mode is hold/toggle-to-talk: the pill should be visible
  // but should not be an app the user can click into. If the Browser
  // window accepts mouse events it feels like a normal floating panel
  // and can interfere with the app underneath. Hands-free mode is the
  // explicit exception because its X/stop buttons need pointer input.
  status.setIgnoreMouseEvents(!settings.handsFreeMode, { forward: true })
}
