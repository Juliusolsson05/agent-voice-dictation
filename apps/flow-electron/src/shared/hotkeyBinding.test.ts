import assert from 'node:assert/strict'
import test from 'node:test'

import {
  bindingFromKeyboardEvent,
  cloneEmptyModifiers,
  formatBindingForDisplay,
  modifierOnlyBinding,
  toElectronAccelerator,
  updateHeldModifier,
  type KeyboardEventLike,
} from './hotkeyBinding.js'

function event(partial: Partial<KeyboardEventLike>): KeyboardEventLike {
  return {
    key: partial.key ?? '',
    code: partial.code ?? '',
    metaKey: partial.metaKey,
    ctrlKey: partial.ctrlKey,
    altKey: partial.altKey,
    shiftKey: partial.shiftKey,
  }
}

test('records Option+SPACE even when the Space event loses altKey on macOS', () => {
  const held = cloneEmptyModifiers()
  updateHeldModifier(event({ key: 'Alt', code: 'AltLeft', altKey: true }), held, true)

  const result = bindingFromKeyboardEvent(
    event({ key: ' ', code: 'Space', altKey: false }),
    held,
  )

  assert.equal(result.binding, 'Option+SPACE')
  assert.equal(result.error, null)
})

test('records bare Fn as a valid modifier-only binding', () => {
  const held = cloneEmptyModifiers()
  updateHeldModifier(event({ key: 'Fn', code: 'Fn' }), held, true)

  assert.equal(modifierOnlyBinding(held), 'Fn')
})

test('records bare Cmd as a valid modifier-only binding', () => {
  const held = cloneEmptyModifiers()
  updateHeldModifier(event({ key: 'Meta', code: 'MetaLeft', metaKey: true }), held, true)

  assert.equal(modifierOnlyBinding(held), 'Cmd')
})

test('records punctuation using the native helper vocabulary', () => {
  const result = bindingFromKeyboardEvent(event({ key: '.', code: 'Period' }), cloneEmptyModifiers())

  assert.equal(result.binding, 'DOT')
})

// The bracket labels were previously swapped (left key labeled CLOSE, right
// key labeled OPEN). Lock the corrected mapping so a future edit cannot
// silently re-swap them — both halves of the round-trip would have to be
// wrong in the same direction to mask it, exactly as before.
test('records BracketLeft as BRACKET_LEFT (the [ key)', () => {
  const result = bindingFromKeyboardEvent(event({ key: '[', code: 'BracketLeft' }), cloneEmptyModifiers())
  assert.equal(result.binding, 'BRACKET_LEFT')
})

test('records BracketRight as BRACKET_RIGHT (the ] key)', () => {
  const result = bindingFromKeyboardEvent(event({ key: ']', code: 'BracketRight' }), cloneEmptyModifiers())
  assert.equal(result.binding, 'BRACKET_RIGHT')
})

test('records modifier plus destructive key without rejecting Backspace', () => {
  const held = cloneEmptyModifiers()
  updateHeldModifier(event({ key: 'Meta', code: 'MetaLeft', metaKey: true }), held, true)

  const result = bindingFromKeyboardEvent(
    event({ key: 'Backspace', code: 'Backspace', metaKey: true }),
    held,
  )

  assert.equal(result.binding, 'Cmd+BACKSPACE')
})

test('formats helper bindings for humans without changing storage vocabulary', () => {
  assert.equal(formatBindingForDisplay('Option+SPACE'), 'Option + Space')
  assert.equal(formatBindingForDisplay('Cmd+BACKSPACE'), 'Cmd + Backspace')
  assert.equal(formatBindingForDisplay('DOT'), '.')
})

test('converts helper binding vocabulary to Electron fallback accelerators', () => {
  assert.equal(toElectronAccelerator('Option+SPACE'), 'Alt+Space')
  assert.equal(toElectronAccelerator('Cmd+BACKSPACE'), 'Cmd+Backspace')
})
