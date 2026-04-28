import { useCallback, useEffect, useRef, useState } from 'react'

import {
  bindingFromKeyboardEvent,
  cloneEmptyModifiers,
  formatBindingForDisplay,
  isModifierKey,
  modifierOnlyBinding,
  updateHeldModifier,
  type HeldModifiers,
} from '../../shared/hotkeyBinding'

// HotkeyInput captures a physical key combination and stores it in
// the same vocabulary consumed by the macOS CGEventTap helper
// (e.g. "Option+SPACE", "Fn", "Cmd+BACKSPACE").
//
// Why not a plain text input: users mistyping "Cmd+Space" vs
// "Command+Space" vs "⌘ Space" all silently fail registration in
// `globalShortcut.register`. That was the first implementation and
// it failed for the actual product requirement: arbitrary Mac keys,
// including Fn and bare modifiers. The renderer now records what the
// user asked for; main decides how to implement it per platform.
//
// Behavior:
//   - Click the field to enter capture mode.
//   - Press the combo. Bare modifiers are valid because Wispr/Raycast
//     style dictation launchers commonly use Fn or single modifiers.
//   - On a valid combo we save and exit capture mode automatically.
//   - Escape exits capture mode WITHOUT saving (lets the user back
//     out without changing the existing binding).

type Props = {
  value: string
  onChange: (next: string) => void | Promise<void>
  placeholder?: string
}

export function HotkeyInput({ value, onChange, placeholder }: Props) {
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const heldModifiersRef = useRef<HeldModifiers>(cloneEmptyModifiers())
  const modifierCommitTimerRef = useRef<number | null>(null)

  const start = useCallback(() => {
    // eslint-disable-next-line no-console
    console.log('[HotkeyInput] start capture')
    setError(null)
    heldModifiersRef.current = cloneEmptyModifiers()
    if (modifierCommitTimerRef.current) window.clearTimeout(modifierCommitTimerRef.current)
    setCapturing(true)
  }, [])
  const stop = useCallback(() => {
    // eslint-disable-next-line no-console
    console.log('[HotkeyInput] stop capture')
    heldModifiersRef.current = cloneEmptyModifiers()
    if (modifierCommitTimerRef.current) window.clearTimeout(modifierCommitTimerRef.current)
    setCapturing(false)
  }, [])

  useEffect(() => {
    if (!capturing) return
    // eslint-disable-next-line no-console
    console.log('[HotkeyInput] listener attached')
    const clearModifierCommitTimer = () => {
      if (modifierCommitTimerRef.current) {
        window.clearTimeout(modifierCommitTimerRef.current)
        modifierCommitTimerRef.current = null
      }
    }
    const onKey = (e: KeyboardEvent) => {
      // Always intercept while in capture mode; otherwise the user's
      // chord might trigger a real shortcut in the app.
      e.preventDefault()
      e.stopPropagation()
      // eslint-disable-next-line no-console
      console.log('[HotkeyInput] keydown', {
        key: e.key,
        code: e.code,
        meta: e.metaKey,
        ctrl: e.ctrlKey,
        alt: e.altKey,
        shift: e.shiftKey,
        held: heldModifiersRef.current,
      })
      updateHeldModifier(e, heldModifiersRef.current, true)
      if (e.key === 'Escape') {
        setCapturing(false)
        setError(null)
        heldModifiersRef.current = cloneEmptyModifiers()
        clearModifierCommitTimer()
        return
      }
      if (isModifierKey(e)) {
        const modifierOnly = modifierOnlyBinding(heldModifiersRef.current)
        clearModifierCommitTimer()
        if (modifierOnly) {
          modifierCommitTimerRef.current = window.setTimeout(() => {
            void Promise.resolve(onChange(modifierOnly)).then(() => setCapturing(false))
          }, 450)
        }
        return
      }
      clearModifierCommitTimer()
      const { binding: accel, error: nextError } = bindingFromKeyboardEvent(
        e,
        heldModifiersRef.current,
      )
      // eslint-disable-next-line no-console
      console.log('[HotkeyInput] accelerator', accel, nextError)
      setError(nextError)
      if (!accel) return
      void Promise.resolve(onChange(accel)).then(() => setCapturing(false))
    }
    const onKeyUp = (e: KeyboardEvent) => {
      updateHeldModifier(e, heldModifiersRef.current, false)
      if (!modifierOnlyBinding(heldModifiersRef.current)) clearModifierCommitTimer()
    }
    const onBlur = () => {
      heldModifiersRef.current = cloneEmptyModifiers()
      clearModifierCommitTimer()
    }
    // Use capture phase so we run before any other handlers.
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      // eslint-disable-next-line no-console
      console.log('[HotkeyInput] listener detached')
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
      heldModifiersRef.current = cloneEmptyModifiers()
      clearModifierCommitTimer()
    }
  }, [capturing, onChange])

  // Click-outside dismisses capture mode without saving.
  useEffect(() => {
    if (!capturing) return
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) {
        setCapturing(false)
      }
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [capturing])

  const display = value ? formatBindingForDisplay(value) : ''

  return (
    <div ref={containerRef}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={() => {
            // eslint-disable-next-line no-console
            console.log('[HotkeyInput] button clicked, capturing was', capturing)
            if (capturing) stop()
            else start()
          }}
          style={{
            flex: 1,
            padding: '8px 10px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid ' + (capturing ? 'var(--accent)' : 'var(--border)'),
            background: capturing ? 'var(--surface-2)' : 'var(--surface)',
            color: 'var(--ink)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            textAlign: 'left',
            cursor: 'pointer',
          }}
          aria-pressed={capturing}
        >
          {capturing
            ? 'Press any key or shortcut'
            : display || placeholder || 'Click to set hotkey'}
        </button>
        {value && !capturing && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void onChange('Option+SPACE')}
            title="Restore default binding"
          >
            Default
          </button>
        )}
      </div>
      {!capturing && (
        // Chromium does not reliably surface every hardware modifier
        // as a renderer keydown event. Fn is the important case: the
        // native helper can observe it via CGEventFlags.maskSecondaryFn,
        // but the web picker may never receive a key event to record.
        // These presets keep the UI honest: they are not alternate
        // bindings or text-entry escape hatches, just explicit choices
        // for native-only triggers that the renderer may be blind to.
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void onChange('Fn')}
            title="Use the Mac fn key"
          >
            fn
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void onChange('Cmd')}
            title="Use the Command key"
          >
            Cmd
          </button>
        </div>
      )}
      {error && (
        <div style={{ marginTop: 6, color: 'var(--muted)', fontSize: 11 }}>
          {error}
        </div>
      )}
    </div>
  )
}
