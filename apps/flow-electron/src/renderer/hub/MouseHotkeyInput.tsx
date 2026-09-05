import { useEffect, useRef, useState } from 'react'
import { bindingFromMouseEvent, displayMouseBinding } from '../../shared/mouseBinding'
import { bindingFromKeyboardEvent, cloneEmptyModifiers, isModifierKey } from '../../shared/hotkeyBinding'

export function MouseHotkeyInput({ value, onChange, onKeyboardChange }: {
  value: string | null
  onChange: (binding: string | null) => Promise<void>
  onKeyboardChange?: (binding: string) => Promise<void>
}) {
  const [capturing, setCapturing] = useState(false)
  const [armed, setArmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detected, setDetected] = useState('')
  // Settings callbacks change identity after saving. Keep the active capture
  // session stable so a render cannot briefly re-enable the native event tap.
  const callbacks = useRef({ onChange, onKeyboardChange })
  callbacks.current = { onChange, onKeyboardChange }
  const available = window.flow.app.platform === 'darwin'

  useEffect(() => {
    if (!capturing) return
    let disposed = false, ready = false, committing = false
    let pending: { binding: string; button: number } | null = null
    setArmed(false)
    void window.flow.hotkeys.capture(true).then(() => {
      if (!disposed) { ready = true; setArmed(true) }
    }).catch(() => {
      if (!disposed) { setError('Could not pause shortcuts for capture.'); setCapturing(false) }
    })
    const commit = async (binding: string, keyboard: boolean) => {
      if (committing) return
      committing = true
      setSaving(true)
      try {
        if (keyboard) await callbacks.current.onKeyboardChange?.(binding)
        else await callbacks.current.onChange(binding)
        if (!disposed) setCapturing(false)
      } catch {
        if (!disposed) setError('Could not save the shortcut. Try again.')
      } finally {
        committing = false
        if (!disposed) setSaving(false)
      }
    }
    const mouseDown = (event: MouseEvent) => {
      if (!ready || committing) return
      const binding = bindingFromMouseEvent(event)
      if (!binding) return // Leave ordinary clicks available for Cancel.
      event.preventDefault(); event.stopImmediatePropagation()
      pending = { binding, button: event.button }
      setDetected(`Detected ${displayMouseBinding(binding)} — release to save`)
    }
    const mouseUp = (event: MouseEvent) => {
      if (!pending || event.button !== pending.button) return
      event.preventDefault(); event.stopImmediatePropagation()
      // Save on release: reactivating the native tap on down would deliver an
      // orphan up and can accidentally start another action in the focused app.
      const binding = pending.binding
      pending = null
      void commit(binding, false)
    }
    const keyDown = (event: KeyboardEvent) => {
      if (!ready || committing) return
      if (event.key === 'Escape') { event.preventDefault(); setCapturing(false); return }
      if (isModifierKey(event)) return // Allow Shift+mouse etc. to be assembled.
      event.preventDefault(); event.stopImmediatePropagation()
      const result = bindingFromKeyboardEvent(event, cloneEmptyModifiers())
      if (result.binding && callbacks.current.onKeyboardChange) {
        setDetected(`Detected keyboard shortcut: ${result.binding}`)
        void commit(result.binding, true)
      } else setError(result.error || 'Use the keyboard shortcut field for this key.')
    }
    const suppressAux = (event: MouseEvent) => { if (ready) event.preventDefault() }
    const blur = () => setCapturing(false)
    window.addEventListener('mousedown', mouseDown, true)
    window.addEventListener('mouseup', mouseUp, true)
    window.addEventListener('keydown', keyDown, true)
    window.addEventListener('auxclick', suppressAux, true)
    window.addEventListener('blur', blur)
    return () => {
      disposed = true
      window.removeEventListener('mousedown', mouseDown, true)
      window.removeEventListener('mouseup', mouseUp, true)
      window.removeEventListener('keydown', keyDown, true)
      window.removeEventListener('auxclick', suppressAux, true)
      window.removeEventListener('blur', blur)
      void window.flow.hotkeys.capture(false).catch(() => {})
    }
  }, [capturing])

  return <div style={{ display: 'grid', gap: 10 }}>
    <button type="button" className="input" aria-label="Capture keyboard or mouse shortcut"
      aria-pressed={capturing} disabled={saving || !available}
      onClick={() => { setError(null); setDetected(''); setSaving(false); setCapturing(true) }}>
      {capturing ? armed ? 'Press a key or mouse button here…' : 'Preparing input capture…'
        : value ? `${displayMouseBinding(value)} — click to change` : 'Click, then press a key or mouse button'}
    </button>
    {capturing && <button type="button" className="btn" onClick={() => setCapturing(false)}>Cancel capture</button>}
    {!capturing && value && <button type="button" className="btn btn-ghost" onClick={() => {
      void onChange(null).catch(() => setError('Could not disable the mouse shortcut.'))
    }}>Disable mouse shortcut</button>}
    <span role="status" style={{ fontSize: 12, color: 'var(--ink-dim)' }}>
      {!available ? 'Global mouse shortcuts require macOS.' : saving ? 'Saving shortcut…'
        : capturing ? detected || 'Click your scroll wheel or a side button. Hold modifiers for a combination. Escape cancels.'
        : value ? `Hold ${displayMouseBinding(value)} to dictate. Your keyboard shortcut also works.`
        : 'Mouse input changes this shortcut; keyboard input updates the keyboard shortcut above. Ordinary left and right clicks stay available.'}
    </span>
    {error && <span role="alert" style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</span>}
  </div>
}
