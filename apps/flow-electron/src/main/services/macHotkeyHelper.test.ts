import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({ spawn: vi.fn(), readFile: vi.fn() }))
vi.mock('electron', () => ({ app: { getAppPath: () => '/app', getPath: () => '/profile' } }))
vi.mock('node:child_process', () => ({ spawn: mocked.spawn }))
vi.mock('node:fs/promises', () => ({
  readFile: mocked.readFile, access: vi.fn().mockResolvedValue(undefined),
  chmod: vi.fn(), mkdir: vi.fn(), stat: vi.fn(),
}))
import { startMacHotkeyHelper, stopMacHotkeyHelper } from './macHotkeyHelper'

function processStub() {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
  })
}
let current: ReturnType<typeof processStub>
const down = vi.fn(), up = vi.fn()
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('process', { ...process, platform: 'darwin' })
  mocked.readFile.mockReset().mockResolvedValue(Buffer.from('test-source'))
  mocked.spawn.mockReset().mockImplementation(() => { current = processStub(); return current })
  down.mockReset(); up.mockReset()
})
afterEach(() => {
  stopMacHotkeyHelper()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
async function start() {
  const pending = startMacHotkeyHelper('Fn', { onPress: down, onRelease: up }, undefined, 'MOUSE_MIDDLE')
  await vi.waitFor(() => expect(mocked.spawn).toHaveBeenCalled())
  current.stdout.emit('data', '{"type":"ready"}\n')
  expect(await pending).toBe(true)
}
it('frames split protocol lines and sends both bindings to the native process', async () => {
  await start()
  expect(mocked.spawn.mock.calls[0][1]).toEqual(['Fn', expect.any(String), 'MOUSE_MIDDLE'])
  current.stdout.emit('data', '{"type":"hotkey-')
  current.stdout.emit('data', 'down"}\n{"type":"hotkey-down"}\n{"type":"hotkey-')
  current.stdout.emit('data', 'up"}\n')
  expect(down).toHaveBeenCalledOnce()
  expect(up).toHaveBeenCalledOnce()
})
it('an old process exit cannot clear the replacement or its active gesture', async () => {
  await start()
  const previous = current
  const second = startMacHotkeyHelper('F8', { onPress: down, onRelease: up })
  await vi.waitFor(() => expect(mocked.spawn).toHaveBeenCalledTimes(2))
  current.stdout.emit('data', '{"type":"ready"}\n{"type":"hotkey-down"}\n')
  expect(await second).toBe(true)
  previous.emit('exit', 0)
  expect(up).not.toHaveBeenCalled()
  stopMacHotkeyHelper()
  expect(current.kill).toHaveBeenCalledOnce()
  expect(up).toHaveBeenCalledOnce()
})
it('does not launch an obsolete request after delayed source reads finish', async () => {
  let complete!: (value: Buffer) => void
  mocked.readFile.mockImplementation(() => new Promise(resolve => { complete = resolve }))
  // Both source reads must settle; use one shared deferred build input.
  const input = new Promise<Buffer>(resolve => { complete = resolve })
  mocked.readFile.mockReturnValue(input)
  const pending = startMacHotkeyHelper('Fn', { onPress: down })
  stopMacHotkeyHelper()
  complete(Buffer.from('test-source'))
  expect(await pending).toBe(false)
  expect(mocked.spawn).not.toHaveBeenCalled()
})
it('requires native readiness and handles spawn failure without an unhandled error', async () => {
  const pending = startMacHotkeyHelper('Fn', { onPress: down })
  await vi.waitFor(() => expect(mocked.spawn).toHaveBeenCalled())
  current.emit('error', new Error('spawn failed'))
  expect(await pending).toBe(false)
  expect(down).not.toHaveBeenCalled()
})

it('reports actual readiness and last received shortcut separately from saved preferences', async () => {
  const { getMacHotkeyHelperStatus } = await import('./macHotkeyHelper')
  await start()
  expect(getMacHotkeyHelperStatus().running).toBe(true)
  current.stdout.emit('data', '{"type":"hotkey-down"}\n')
  expect(getMacHotkeyHelperStatus().lastPressAt).toBeTypeOf('number')
  current.emit('exit', 1)
  expect(getMacHotkeyHelperStatus().running).toBe(false)
  expect(getMacHotkeyHelperStatus().error).toContain('stopped')
})
it('surfaces permission refusal instead of presenting saved bindings as active', async () => {
  const { getMacHotkeyHelperStatus } = await import('./macHotkeyHelper')
  const pending = startMacHotkeyHelper('Fn', { onPress: down })
  await vi.waitFor(() => expect(mocked.spawn).toHaveBeenCalled())
  current.stdout.emit('data', '{"type":"permission-required"}\n')
  current.emit('exit', 66)
  expect(await pending).toBe(false)
  expect(getMacHotkeyHelperStatus().running).toBe(false)
  expect(getMacHotkeyHelperStatus().error).toContain('Accessibility')
})
