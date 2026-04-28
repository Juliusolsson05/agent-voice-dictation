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
        // `ws` has optional native helpers (`bufferutil`, `utf-8-validate`) and
        // a fallback shim. Bundling it through Vite/Rollup produced a broken
        // runtime object where `bufferUtil.mask` was not a function, crashing on
        // every audio chunk send. Main runs in Node, so the correct shape is to
        // leave `ws` as a runtime dependency and let Node resolve it normally.
        external: ['ws'],
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
    //
    // Use an absolute outDir. Vite resolves a relative outDir against
    // the renderer `root`, not against this config file, which on a
    // first build silently put the files four levels up
    // (~Desktop/Development/agent-voice-dictation/out/renderer)
    // instead of inside the app — Electron then 404'd on file://.
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
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
