import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const location = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => location.userData } }))

beforeEach(async () => {
  location.userData = await mkdtemp(join(tmpdir(), 'flow-settings-'))
  vi.resetModules()
})
afterEach(async () => { await rm(location.userData, { recursive: true, force: true }) })

it('persists an explicit microphone across a fresh settings-store load', async () => {
  const store = await import('./settingsStore')
  expect((await store.loadSettings()).microphoneDeviceId).toBeNull()
  await store.saveSettings({ microphoneDeviceId: 'continuity-device' })
  expect(JSON.parse(await readFile(join(location.userData, 'settings.json'), 'utf8')).microphoneDeviceId)
    .toBe('continuity-device')
  vi.resetModules()
  const restarted = await import('./settingsStore')
  expect((await restarted.loadSettings()).microphoneDeviceId).toBe('continuity-device')
  await restarted.saveSettings({ microphoneDeviceId: null })
  vi.resetModules()
  expect((await (await import('./settingsStore')).loadSettings()).microphoneDeviceId).toBeNull()
})
