import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// electron-vite gives us three independent build targets in one config:
// main process, preload, and renderer. We use it instead of a hand-rolled
// vite + esbuild setup because we'd just end up reimplementing the same
// three-pipe layout with worse defaults — electron-vite already handles
// HMR for the renderer while restarting main on edits.

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  main: {
    // The main process imports the agent-voice-dictation package directly
    // (via the file: link in package.json). We do not bundle the
    // package's renderer-only modules into main — node-side fetch is
    // available natively in Electron 31, so the speech and openrouter
    // clients work as-is.
    resolve: {
      alias: {
        '@main': resolve(__dirname, 'src/main'),
      },
    },
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
      },
    },
  },
  preload: {
    resolve: {
      alias: {
        '@preload': resolve(__dirname, 'src/preload'),
      },
    },
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
      },
    },
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer'),
      },
    },
    root: resolve(__dirname, 'src/renderer'),
    // Two HTML entry points, one per window. Electron loads them via
    // file:// in production and via the dev server URL with the route
    // path in development (the windows themselves pick which HTML to
    // load via createWindow's loadFile/loadURL branch).
    build: {
      outDir: '../../out/renderer',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          hub: resolve(__dirname, 'src/renderer/hub/index.html'),
          status: resolve(__dirname, 'src/renderer/status/index.html'),
        },
      },
    },
  },
})
