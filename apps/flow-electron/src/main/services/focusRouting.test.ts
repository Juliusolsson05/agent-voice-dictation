import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ query: vi.fn(), targets: vi.fn(), binary: vi.fn() }))
vi.mock('node:util', () => ({ promisify: () => mocks.query }))
vi.mock('./macHotkeyHelper', () => ({ ensureHelperBinary: mocks.binary }))
vi.mock('./dictationRouting', () => ({ getHotkeyYieldTargets: mocks.targets }))
import { allowsAutomaticPaste } from './focusRouting'
beforeEach(() => {
  vi.stubGlobal('process', { ...process, platform: 'darwin' })
  mocks.query.mockReset().mockResolvedValue({ stdout: 'false\n' })
  mocks.targets.mockReset().mockResolvedValue({ frontmostBundleIds: ['com.agentcode.app'], frontmostAppNames: ['Agent Code'] })
  mocks.binary.mockReset().mockResolvedValue('/Applications/Agent Voice.app/helper')
})
afterEach(() => vi.unstubAllGlobals())
it('rechecks native text focus immediately before deciding to paste', async () => {
  expect(await allowsAutomaticPaste()).toBe(true)
  mocks.query.mockResolvedValue({ stdout: 'true\n' })
  expect(await allowsAutomaticPaste()).toBe(false)
  expect(mocks.query).toHaveBeenCalledTimes(2)
  expect(mocks.query.mock.calls[1][1][0]).toBe('--query-yield')
})
it.each(['', 'unexpected', 'true'])('keeps clipboard-only output when focus response is %j', async stdout => {
  mocks.query.mockResolvedValue({ stdout })
  expect(await allowsAutomaticPaste()).toBe(false)
})
it('keeps clipboard-only output if the native focus query fails', async () => {
  mocks.query.mockRejectedValue(new Error('timeout'))
  expect(await allowsAutomaticPaste()).toBe(false)
})
it('does not impose focus routing when the integration is disabled', async () => {
  mocks.targets.mockResolvedValue({ frontmostBundleIds: [], frontmostAppNames: [] })
  expect(await allowsAutomaticPaste()).toBe(true)
  expect(mocks.query).not.toHaveBeenCalled()
})
