import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MouseHotkeyInput } from './MouseHotkeyInput'
let view: ReactTestRenderer
const save = vi.fn(), keyboard = vi.fn(), capture = vi.fn()
beforeEach(() => {
  save.mockReset().mockResolvedValue(undefined)
  keyboard.mockReset().mockResolvedValue(undefined)
  capture.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('window', Object.assign(new EventTarget(), { flow: { app: { platform: 'darwin' }, hotkeys: { capture } } }))
})
afterEach(() => { if (view) act(() => view.unmount()); vi.unstubAllGlobals() })
async function mount() {
  await act(async () => { view = create(React.createElement(MouseHotkeyInput, { value: 'MOUSE_MIDDLE', onChange: save, onKeyboardChange: keyboard })) })
  await act(async () => { view.root.findByProps({ 'aria-label': 'Capture keyboard or mouse shortcut' }).props.onClick() })
}
async function event(type: string, props: object) {
  await act(async () => { window.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), props)) })
}
it('captures the physical middle press with modifiers only after release and preserves the keyboard', async () => {
  await mount()
  expect(capture).toHaveBeenCalledWith(true)
  await event('mousedown', { button: 1, shiftKey: true })
  expect(save).not.toHaveBeenCalled()
  expect(view.root.findByProps({ role: 'status' }).children.join('')).toContain('Detected Shift + Middle click')
  await event('mouseup', { button: 1 })
  expect(save).toHaveBeenCalledWith('Shift+MOUSE_MIDDLE')
  expect(keyboard).not.toHaveBeenCalled()
  expect(capture).toHaveBeenLastCalledWith(false)
})
it('captures extended mouse buttons rather than limiting selection to a menu', async () => {
  await mount()
  await event('mousedown', { button: 6 })
  await event('mouseup', { button: 6 })
  expect(save).toHaveBeenCalledWith('MOUSE_7')
})
it('records a keyboard event into the keyboard slot and leaves the mouse slot intact', async () => {
  await mount()
  await event('keydown', { key: 'a', code: 'KeyA', ctrlKey: true, getModifierState: () => false })
  expect(keyboard).toHaveBeenCalledWith('Ctrl+A')
  expect(save).not.toHaveBeenCalled()
})
it('ignores ordinary clicks and cancels safely on Escape or window dismissal', async () => {
  await mount()
  await event('mousedown', { button: 0 })
  await event('mouseup', { button: 0 })
  expect(save).not.toHaveBeenCalled()
  await event('keydown', { key: 'Escape' })
  expect(capture).toHaveBeenLastCalledWith(false)
})
it('reports persistence failure without claiming success', async () => {
  await mount()
  save.mockRejectedValueOnce(new Error('disk failure'))
  await event('mousedown', { button: 1 })
  await event('mouseup', { button: 1 })
  expect(view.root.findByProps({ role: 'alert' }).children.join('')).toContain('Could not save')
})
