import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

if (process.platform !== 'darwin') throw new Error('Native binding tests require macOS.')
const dir = await mkdtemp(join(tmpdir(), 'voice-native-tests-'))
try {
  const sources = resolve('native/macos-hotkey-helper/Sources/AgentVoiceHotkeyHelper')
  const env = { ...process.env, CLANG_MODULE_CACHE_PATH: join(dir, 'module-cache') }
  const compile = (main, output) => execFileSync('/usr/bin/xcrun',
    ['swiftc', join(sources, 'BindingState.swift'), main, '-o', output],
    { env, stdio: 'inherit', timeout: 120000 })
  compile(resolve('native/macos-hotkey-helper/Tests/main.swift'), join(dir, 'tests'))
  execFileSync(join(dir, 'tests'), { stdio: 'inherit', timeout: 10000 })
  // Compile the real event tap too, but never install it or post OS input in tests.
  compile(join(sources, 'main.swift'), join(dir, 'helper'))
} finally { await rm(dir, { recursive: true, force: true }) }
