import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, chmod, mkdir, readFile, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'

let child: ChildProcessWithoutNullStreams | null = null

export async function startMacHotkeyHelper(
  binding: string,
  handlers: { onPress: () => void; onRelease?: () => void },
): Promise<boolean> {
  stopMacHotkeyHelper()

  if (process.platform !== 'darwin') return false

  try {
    const binary = await ensureHelperBinary()
    child = spawn(binary, [binding], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      for (const line of String(chunk).split('\n')) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line) as { type?: string }
          if (event.type === 'hotkey' || event.type === 'hotkey-down') handlers.onPress()
          if (event.type === 'hotkey-up') handlers.onRelease?.()
          if (event.type === 'ready') {
            // eslint-disable-next-line no-console
            console.log(`[hotkey] mac helper ready for "${binding}"`)
          }
        } catch {
          // eslint-disable-next-line no-console
          console.log('[hotkey] mac helper stdout:', line)
        }
      }
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      // eslint-disable-next-line no-console
      console.warn(String(chunk).trim())
    })

    child.on('exit', (code, signal) => {
      if (child) {
        // eslint-disable-next-line no-console
        console.warn(`[hotkey] mac helper exited code=${code ?? 'null'} signal=${signal ?? 'null'}`)
      }
      child = null
    })

    return true
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[hotkey] failed to start mac helper', err)
    stopMacHotkeyHelper()
    return false
  }
}

export function stopMacHotkeyHelper(): void {
  if (!child) return
  const current = child
  child = null
  current.kill()
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
  const source = join(
    app.getAppPath(),
    'native/macos-hotkey-helper/Sources/AgentVoiceHotkeyHelper/main.swift',
  )
  const sourceBytes = await readFile(source)
  const hash = createHash('sha256').update(sourceBytes).digest('hex').slice(0, 12)
  const dir = join(app.getPath('userData'), 'native-helpers')
  const target = join(dir, `AgentVoiceHotkeyHelper-${hash}`)

  try {
    await access(target, constants.X_OK)
    return target
  } catch {
    // Missing or not executable; compile below.
  }

  await mkdir(dir, { recursive: true })
  await compileSwift(source, target)
  await chmod(target, 0o755)
  await stat(target)
  return target
}

function compileSwift(source: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const compiler = spawn('/usr/bin/xcrun', ['swiftc', source, '-O', '-o', target], {
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
