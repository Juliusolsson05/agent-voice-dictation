import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  settings: { hotkey: 'Fn', mouseHotkey: 'MOUSE_MIDDLE' },
  start: vi.fn(), stop: vi.fn(), targets: vi.fn(), unregister: vi.fn(),
}))
vi.mock('electron', () => ({ globalShortcut: { unregisterAll: mocks.unregister } }))
vi.mock('@main/services/settingsStore.js', () => ({
  DEFAULT_SETTINGS: { hotkey: 'Option+SPACE' },
  loadSettings: async () => mocks.settings, saveSettings: vi.fn(),
}))
vi.mock('@main/services/macHotkeyHelper.js', () => ({
  startMacHotkeyHelper: mocks.start, stopMacHotkeyHelper: mocks.stop,
}))
vi.mock('@main/services/dictationRouting.js', () => ({ getHotkeyYieldTargets: mocks.targets }))

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('process', { ...process, platform: 'darwin' })
  mocks.start.mockReset().mockResolvedValue(true)
  mocks.targets.mockReset().mockResolvedValue({ frontmostBundleIds: [], frontmostAppNames: [] })
})
import { afterEach } from 'vitest'
afterEach(() => vi.unstubAllGlobals())

it('registers both shortcuts and suspends them until every capture owner releases', async () => {
  const service = await import('./hotkey')
  const down = vi.fn()
  service.configureHotkeyHandler(down)
  await service.registerConfiguredHotkey()
  expect(mocks.start).toHaveBeenLastCalledWith('Fn', expect.objectContaining({ onPress: down }), expect.any(Object), 'MOUSE_MIDDLE')
  mocks.start.mockClear()
  await service.setHotkeyCapture(1, true)
  await service.setHotkeyCapture(2, true)
  await service.setHotkeyCapture(1, false)
  expect(mocks.start).not.toHaveBeenCalled()
  await service.setHotkeyCapture(2, false)
  expect(mocks.start).toHaveBeenCalledOnce()
})

it('an old integration lookup cannot reactivate shortcuts during capture', async () => {
  const service = await import('./hotkey')
  service.configureHotkeyHandler(vi.fn())
  let resolve!: (value: unknown) => void
  mocks.targets.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const pending = service.registerConfiguredHotkey()
  await vi.waitFor(() => expect(mocks.targets).toHaveBeenCalled())
  await service.setHotkeyCapture(1, true)
  resolve({ frontmostBundleIds: [], frontmostAppNames: [] })
  await pending
  expect(mocks.start).not.toHaveBeenCalled()
})
