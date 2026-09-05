import { app } from 'electron'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { access, chmod, mkdir, readFile, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'

let child: ChildProcessByStdio<null, Readable, Readable> | null = null
let generation = 0
let releaseHeld: (() => void) | null = null
let building: Promise<string> | null = null

export async function startMacHotkeyHelper(
  binding: string,
  handlers: { onPress: () => void; onRelease?: () => void },
  yieldTargets: { frontmostBundleIds: string[]; frontmostAppNames: string[] }
    = { frontmostBundleIds: [], frontmostAppNames: [] },
  mouseBinding: string | null = null,
): Promise<boolean> {
  stopMacHotkeyHelper()
  const request = generation
  if (process.platform !== 'darwin') return false
  try {
    // Coalesce builds: simultaneous preference updates must not write the same
    // executable concurrently. Generation still decides which request may launch.
    building ??= ensureHelperBinary().finally(() => { building = null })
    const binary = await building
    if (request !== generation) return false
    const current = spawn(binary, [binding, JSON.stringify(yieldTargets), mouseBinding ?? ''], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child = current
    let held = false
    const release = () => {
      if (held) { held = false; handlers.onRelease?.() }
    }
    releaseHeld = release
    return await new Promise<boolean>(resolve => {
      let settled = false
      const finish = (ok: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve(ok)
      }
      const timeout = setTimeout(() => {
        if (child === current) stopMacHotkeyHelper()
        finish(false)
      }, 5000)
      let pending = ''
      current.stdout.setEncoding('utf8')
      current.stdout.on('data', chunk => {
        if (request !== generation || child !== current) return
        // Pipes split JSON at arbitrary byte boundaries. Preserve partial lines
        // so a split hotkey-up cannot leave the recorder running indefinitely.
        pending += String(chunk)
        if (pending.length > 32768) { stopMacHotkeyHelper(); finish(false); return }
        const lines = pending.split('\n')
        pending = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line) as { type?: string }
            if (event.type === 'ready') finish(true)
            if ((event.type === 'hotkey-down' || event.type === 'hotkey') && !held) {
              held = true
              handlers.onPress()
            }
            if (event.type === 'hotkey-up') release()
          } catch { /* Ignore malformed protocol lines, never log input payloads. */ }
        }
      })
      current.stderr.setEncoding('utf8')
      current.stderr.on('data', chunk => console.warn(String(chunk).trim()))
      const ended = () => {
        // A killed predecessor can exit after its replacement starts. Only its
        // own closure may settle here; it must not clear the replacement handle.
        if (child === current) {
          release()
          child = null
          releaseHeld = null
        }
        finish(false)
      }
      current.on('error', ended)
      current.on('exit', ended)
    })
  } catch (err) {
    if (request === generation) {
      console.warn('[hotkey] failed to start mac helper', err)
      stopMacHotkeyHelper()
    }
    return false
  }
}

export function stopMacHotkeyHelper(): void {
  generation += 1
  const current = child
  child = null
  releaseHeld?.()
  releaseHeld = null
  current?.kill()
}

async function ensureHelperBinary(): Promise<string> {
  // We compile from checked-in Swift source instead of depending on a
  // third-party key listener package. The earlier npm wrapper failed
  // because its hidden helper path, chmod behavior, and binding names
  // were all outside our control. This source->cached-binary shape is
  // intentionally explicit: in development it works with normal Xcode
  // command line tools, and in packaging we can later move this same
  // source into a deterministic build step without changing the app's
  // runtime protocol.
  const directory = join(app.getAppPath(), 'native/macos-hotkey-helper/Sources/AgentVoiceHotkeyHelper')
  const sources = ['main.swift', 'BindingState.swift'].map(file => join(directory, file))
  const bytes = await Promise.all(sources.map(source => readFile(source)))
  const hash = createHash('sha256').update(Buffer.concat(bytes)).digest('hex').slice(0, 12)
  const dir = join(app.getPath('userData'), 'native-helpers')
  const target = join(dir, `AgentVoiceHotkeyHelper-${hash}`)

  try {
    await access(target, constants.X_OK)
    return target
  } catch {
    // Missing or not executable; compile below.
  }

  await mkdir(dir, { recursive: true })
  await compileSwift(sources, target)
  await chmod(target, 0o755)
  await stat(target)
  return target
}

function compileSwift(sources: string[], target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const compiler = spawn('/usr/bin/xcrun', ['swiftc', ...sources, '-O', '-o', target], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    compiler.stderr.setEncoding('utf8')
    compiler.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    compiler.on('error', reject)
    compiler.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`swiftc failed with code ${code}: ${stderr.trim()}`))
    })
  })
}
