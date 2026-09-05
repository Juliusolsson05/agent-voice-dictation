import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MouseHotkeyInput } from './MouseHotkeyInput'

let view: ReactTestRenderer
const save = vi.fn<(binding: string | null) => Promise<void>>()
beforeEach(() => {
  save.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('window', { flow: { app: { platform: 'darwin' } } })
})
afterEach(() => { if (view) act(() => view.unmount()); vi.unstubAllGlobals() })
async function mount(value: string | null) {
  await act(async () => { view = create(React.createElement(MouseHotkeyInput, { value, onChange: save })) })
}
it('adds a middle-click trigger and can disable it without altering the keyboard binding', async () => {
  await mount(null)
  await act(async () => { view.root.findByType('select').props.onChange({ target: { value: 'MOUSE_MIDDLE' } }) })
  expect(save).toHaveBeenCalledWith('MOUSE_MIDDLE')
  await act(async () => { view.root.findByType('select').props.onChange({ target: { value: '' } }) })
  expect(save).toHaveBeenLastCalledWith(null)
})
it('saves a keyboard modifier plus the chosen mouse button', async () => {
  await mount('MOUSE_MIDDLE')
  const shift = view.root.findAllByType('input')[3]
  await act(async () => { shift.props.onChange({ target: { checked: true } }) })
  expect(save).toHaveBeenCalledWith('Shift+MOUSE_MIDDLE')
})
it('exposes failed persistence and leaves the current choice intact', async () => {
  await mount(null)
  save.mockRejectedValueOnce(new Error('disk failure'))
  await act(async () => { view.root.findByType('select').props.onChange({ target: { value: 'MOUSE_MIDDLE' } }) })
  expect(view.root.findByProps({ role: 'alert' }).children.join('')).toContain('Could not save')
  expect(view.root.findByType('select').props.value).toBe('')
})
it('does not offer a working mouse binding on an unsupported platform', async () => {
  window.flow.app.platform = 'linux'
  await mount(null)
  expect(view.root.findByType('select').props.disabled).toBe(true)
  expect(view.root.findByProps({ role: 'status' }).children.join('')).toContain('require macOS')
})
