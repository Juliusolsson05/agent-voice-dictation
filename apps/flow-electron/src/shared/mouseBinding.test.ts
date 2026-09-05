import { expect, it } from 'vitest'
import { normalizeMouseBinding, displayMouseBinding } from './mouseBinding'

it('keeps an optional mouse trigger separate and normalizes modifier order', () => {
  expect(normalizeMouseBinding(undefined)).toBeNull()
  expect(normalizeMouseBinding('MOUSE_MIDDLE')).toBe('MOUSE_MIDDLE')
  expect(normalizeMouseBinding('Shift+Option+MOUSE_4')).toBe('Option+Shift+MOUSE_4')
  expect(displayMouseBinding('Shift+MOUSE_MIDDLE')).toBe('Shift + Middle click')
})
it('rejects unsafe ordinary clicks and unsupported or malformed chords', () => {
  for (const value of ['MOUSE_LEFT', 'MOUSE_RIGHT', 'MOUSE_99', 'Shift+Shift+MOUSE_MIDDLE', 'A+MOUSE_MIDDLE', 2]) {
    expect(() => normalizeMouseBinding(value)).toThrow()
  }
})

it('supports extended native buttons and rejects numbers outside the event range', () => {
  expect(normalizeMouseBinding('MOUSE_7')).toBe('MOUSE_7')
  expect(normalizeMouseBinding('MOUSE_32')).toBe('MOUSE_32')
  expect(() => normalizeMouseBinding('MOUSE_33')).toThrow()
})
