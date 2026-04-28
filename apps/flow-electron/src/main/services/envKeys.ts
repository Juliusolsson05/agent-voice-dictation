import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { SttProviderId } from '@main/services/settingsStore.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const STT_ENV_NAMES: Record<SttProviderId, string[]> = {
  assemblyai: ['ASSEMBLYAI_API_KEY', 'ASSEMBLY_AI_API_KEY'],
  deepgram: ['DEEPGRAM_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  gladia: ['GLADIA_API_KEY'],
  elevenlabs: ['ELEVENLABS_API_KEY', 'ELEVEN_LABS_API_KEY'],
}

let loaded = false
let envFile: Record<string, string> = {}

export async function getSttApiKeyFromEnv(provider: SttProviderId): Promise<string | null> {
  await loadEnvFileOnce()
  return firstConfigured(STT_ENV_NAMES[provider])
}

export async function getOpenRouterApiKeyFromEnv(): Promise<string | null> {
  await loadEnvFileOnce()
  return firstConfigured(['OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY'])
}

async function loadEnvFileOnce(): Promise<void> {
  if (loaded) return
  loaded = true

  for (const path of candidateEnvPaths()) {
    try {
      const raw = await readFile(path, 'utf8')
      envFile = { ...parseEnv(raw), ...envFile }
      // eslint-disable-next-line no-console
      console.log(`[env] loaded fallback keys from ${path}`)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        // eslint-disable-next-line no-console
        console.warn(`[env] failed to read ${path}`, err)
      }
    }
  }
}

function candidateEnvPaths(): string[] {
  // In dev/preview app.getAppPath() points at apps/flow-electron, but
  // your fallback keys live at the package root. We compute from this
  // compiled file path instead of process.cwd() because Electron apps
  // are often launched from random terminals or Finder, and cwd is not
  // a reliable source of truth.
  const appRoot = resolve(__dirname, '../..')
  const packageRoot = resolve(appRoot, '../..')
  return [
    join(appRoot, '.env'),
    join(packageRoot, '.env'),
  ]
}

function parseEnv(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key) result[key] = value
  }
  return result
}

function firstConfigured(names: string[]): string | null {
  for (const name of names) {
    const fromProcess = process.env[name]?.trim()
    if (fromProcess) return fromProcess
    const fromFile = envFile[name]?.trim()
    if (fromFile) return fromFile
  }
  return null
}
