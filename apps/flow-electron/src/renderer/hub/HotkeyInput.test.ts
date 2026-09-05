import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HotkeyInput } from './HotkeyInput'

let view: ReactTestRenderer
let listeners: Record<string, (event: any) => void>
const capture = vi.fn<(enabled: boolean) => Promise<void>>()
const save = vi.fn<(binding: string) => Promise<void>>()
beforeEach(() => {
  listeners = {}
  capture.mockReset().mockResolvedValue(undefined)
  save.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('window', {
    flow: { hotkeys: { capture } },
    addEventListener: (name: string, listener: (event: any) => void) => { listeners[name] = listener },
    removeEventListener: (name: string) => { delete listeners[name] },
    clearTimeout: vi.fn(), setTimeout: vi.fn(),
  })
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  if (view) act(() => view.unmount())
  vi.unstubAllGlobals(); vi.restoreAllMocks()
})
async function start() {
  await act(async () => {
    view = create(React.createElement(HotkeyInput, { value: 'Fn', onChange: save }))
  })
  await act(async () => { view.root.findAllByType('button')[0].props.onClick() })
}
it('suspends global bindings for capture and restores them after saving', async () => {
  await start()
  expect(capture).toHaveBeenCalledWith(true)
  await act(async () => {
    listeners.keydown({ key: 'F8', code: 'F8', preventDefault() {}, stopPropagation() {} })
  })
  expect(save).toHaveBeenCalledWith('F8')
  expect(capture).toHaveBeenLastCalledWith(false)
})
it('restores global bindings if the editor loses focus or unmounts', async () => {
  await start()
  await act(async () => { listeners.blur({}) })
  expect(capture).toHaveBeenLastCalledWith(false)
  expect(save).not.toHaveBeenCalled()
  await act(async () => { view.root.findAllByType('button')[0].props.onClick() })
  act(() => view.unmount())
  expect(capture).toHaveBeenLastCalledWith(false)
})
