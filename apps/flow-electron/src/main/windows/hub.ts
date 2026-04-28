import { BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// The Hub window is the user-facing app surface: sidebar (Home,
// Settings) + content area. It is the only window that holds focus
// like a normal app — the Status pill is always-on-top and never
// steals focus.

const __dirname = dirname(fileURLToPath(import.meta.url))

let hub: BrowserWindow | null = null

export function getHubWindow(): BrowserWindow | null {
  return hub
}

export function createHubWindow(): BrowserWindow {
  if (hub && !hub.isDestroyed()) {
    hub.show()
    hub.focus()
    return hub
  }
  hub = new BrowserWindow({
    width: 980,
    height: 640,
    minWidth: 720,
    minHeight: 480,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0e0f12',
    webPreferences: {
      // Same preload pattern cc-shell uses: a runtime-relative path
      // because vite path aliases don't intercept Node's join() at
      // runtime. The compiled preload sits at out/preload/index.mjs
      // relative to out/main/index.js.
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  hub.on('ready-to-show', () => {
    hub?.show()
  })

  hub.on('closed', () => {
    hub = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void hub.loadURL(`${process.env.ELECTRON_RENDERER_URL}/hub/index.html`)
  } else {
    void hub.loadFile(join(__dirname, '../renderer/hub/index.html'))
  }
  return hub
}
