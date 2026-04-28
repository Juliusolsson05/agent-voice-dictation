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

let status: BrowserWindow | null = null

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
    y: Math.round(workArea.y + workArea.height - PILL_HEIGHT - 32),
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
  status.showInactive()
}

export function hideStatus(): void {
  if (!status || status.isDestroyed()) return
  status.hide()
}
