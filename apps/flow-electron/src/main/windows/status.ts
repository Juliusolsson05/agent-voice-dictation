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
// macOS Space transitions take ~500ms. If the user enters fullscreen and
// then triggers the hotkey within that window, our showInactive() commits
// while the window server is still re-binding the window to the new
// Space — alwaysOnTop and visibleOnAllWorkspaces are correct in our state
// but not yet honored by the window server. Reasserting one frame later
// catches the race. 60ms is empirical: long enough that the window server
// has stabilized, short enough that the user does not perceive it as a
// flicker. We log when the kick changes anything observable so future
// disappearances can be diagnosed from traces alone.
const OVERLAY_REASSERT_KICK_MS = 60

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

function isPositionOnVisibleDisplay(pos: { x: number; y: number }): boolean {
  // The pill anchors at (pos.x, pos.y); the window extends to
  // (pos.x + PILL_WIDTH, pos.y + PILL_HEIGHT). Treat the position as
  // visible only if the window's center sits inside any current display's
  // work area — the bare top-left can be on-screen while the rest spills
  // off the edge of an external monitor that has since disconnected.
  const cx = pos.x + PILL_WIDTH / 2
  const cy = pos.y + PILL_HEIGHT / 2
  for (const display of screen.getAllDisplays()) {
    const { x, y, width, height } = display.workArea
    if (cx >= x && cx <= x + width && cy >= y && cy <= y + height) return true
  }
  return false
}

function reassertOverlayState(reason: string): void {
  // Single source of truth for the "this window is an overlay" state.
  // Both the initial show and the kick reassert call this — keeping the
  // calls symmetric ensures any future addition (e.g. a new collection
  // behavior flag) lands in both code paths automatically.
  if (!status || status.isDestroyed()) return
  status.setAlwaysOnTop(true, 'screen-saver')
  status.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  status.moveTop()
  // eslint-disable-next-line no-console
  console.log('[status:overlay] reassert', {
    reason,
    isVisible: status.isVisible(),
    bounds: status.getBounds(),
  })
}

export async function createStatusWindow(): Promise<BrowserWindow> {
  if (status && !status.isDestroyed()) return status
  const settings = await loadSettings()
  // Saved position is restored across launches, but the display it was
  // saved on may not be present anymore (closed laptop lid with external
  // monitor disconnected, hot-unplug, display-arrangement change). Without
  // this clamp the pill happily shows() at (2400, 800) into nothing — it
  // is invisible to the user even though Electron thinks it's visible.
  const savedPos = settings.statusWindowPosition
  const pos = savedPos && isPositionOnVisibleDisplay(savedPos)
    ? savedPos
    : defaultPosition()
  if (savedPos && pos !== savedPos) {
    // eslint-disable-next-line no-console
    console.log('[status:overlay] saved position is off-screen, falling back to default', {
      saved: savedPos,
      fallback: pos,
    })
  }

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
    // type: 'panel' is the actual fix for "indicator does not show over
    // fullscreen apps". Naively, setAlwaysOnTop('screen-saver') +
    // setVisibleOnAllWorkspaces({ visibleOnFullScreen: true }) should be
    // enough — the docs even claim it is — but in practice the window
    // silently fails to appear over a native macOS fullscreen Space
    // until the user manually focuses it once (electron/electron#36364).
    // The other documented workaround is app.dock.hide(), which would
    // hide the Hub from the Dock too — not acceptable for an app that
    // wants its main window to behave like a normal app window.
    //
    // 'panel' adds NSWindowStyleMaskNonactivatingPanel at runtime, which
    // is the same NSPanel collection behavior Wispr Flow and similar
    // always-visible mic indicators rely on. The window then floats over
    // any Space (regular or fullscreen) without needing focus to "wake
    // up". Side effect we deliberately want: panel windows are
    // non-activating, so clicks on the hands-free X/stop buttons land
    // without pulling keyboard focus away from the user's target app.
    // (Available in Electron 20+, see electron/electron#34388.) On
    // non-darwin platforms 'panel' is not a valid value, so we omit it
    // and fall back to focusable:false + alwaysOnTop alone.
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    // alwaysOnTop with 'screen-saver' level keeps the pill above
    // fullscreen apps like Zoom too — dictation across all
    // foreground contexts is the whole point. Kept alongside the panel
    // type because Linux/Windows still need it.
    alwaysOnTop: true,
    // Redundant on macOS once `type: 'panel'` is set (panel windows are
    // non-activating by definition), but kept so non-darwin builds still
    // get the "don't steal focus while dictating" guarantee.
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
  // Reassert overlay state every time we show. macOS Spaces / display
  // sleep / Mission Control can quietly downgrade the window's level or
  // collection behavior between shows; trusting the values set in the
  // constructor minutes ago is how the pill ends up invisible.
  reassertOverlayState('show')
  // If the saved position has fallen off the visible display set since
  // last show (display unplugged between dictation sessions), bounce the
  // pill back to the default BEFORE showInactive runs — otherwise the
  // window appears at an off-screen coord and the user thinks the app
  // is broken. The check is cheap (small loop over current displays) and
  // defends a real failure mode the createStatusWindow check cannot
  // catch: display loss while the app is running.
  const [px, py] = status.getPosition()
  if (!isPositionOnVisibleDisplay({ x: px, y: py })) {
    const fallback = defaultPosition()
    // eslint-disable-next-line no-console
    console.log('[status:overlay] runtime reposition: pill was off-screen', {
      was: { x: px, y: py },
      now: fallback,
    })
    status.setPosition(fallback.x, fallback.y, false)
  }
  status.showInactive()
  hideGeneration += 1
  status.webContents.send('status:opening')
  // Kick reassertion. macOS Space transitions during our showInactive
  // can leave the window pinned to the previous Space; reasserting one
  // frame later forces it onto the now-current Space without visibly
  // flickering. This is the single most likely fix for the intermittent
  // "pill does not appear over fullscreen" report — the panel type alone
  // gets us into the right window class, but the Space attachment is
  // negotiated separately and races with our show.
  setTimeout(() => {
    if (!status || status.isDestroyed()) return
    if (!status.isVisible()) return
    reassertOverlayState('kick')
  }, OVERLAY_REASSERT_KICK_MS)
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
