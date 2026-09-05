import { useState } from 'react'
import { displayMouseBinding, MOUSE_BUTTONS, MOUSE_MODIFIERS, normalizeMouseBinding } from '../../shared/mouseBinding'

export function MouseHotkeyInput({ value, onChange }: {
  value: string | null
  onChange: (binding: string | null) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const parts = value?.split('+') ?? []
  const button = parts.at(-1) ?? ''
  const modifiers = parts.slice(0, -1)
  const available = window.flow.app.platform === 'darwin'
  async function save(nextButton: string, nextModifiers = modifiers) {
    setSaving(true)
    setError(null)
    try {
      await onChange(nextButton ? normalizeMouseBinding([...nextModifiers, nextButton].join('+')) : null)
    } catch {
      setError('Could not save the mouse shortcut. Try again.')
    } finally { setSaving(false) }
  }
  return <div style={{ display: 'grid', gap: 10 }}>
    <select aria-label="Mouse shortcut" className="input" value={button}
      disabled={saving || !available} onChange={event => { void save(event.target.value) }}>
      <option value="">Off</option>
      {MOUSE_BUTTONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select>
    {button && <fieldset disabled={saving || !available} style={{ border: 0, padding: 0, margin: 0 }}>
      <legend style={{ fontSize: 11, color: 'var(--ink-dim)', marginBottom: 6 }}>Optional keyboard modifiers</legend>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {MOUSE_MODIFIERS.map(modifier => <label key={modifier} style={{ fontSize: 12 }}>
          <input type="checkbox" checked={modifiers.includes(modifier)}
            onChange={event => {
              const next = event.target.checked ? [...modifiers, modifier] : modifiers.filter(item => item !== modifier)
              void save(button, next)
            }} /> {modifier}
        </label>)}
      </div>
    </fieldset>}
    <span role="status" style={{ fontSize: 11, color: 'var(--ink-dim)' }}>
      {!available ? 'Global mouse shortcuts require macOS.'
        : saving ? 'Saving shortcut…'
        : value ? `Hold ${displayMouseBinding(value)} to dictate. Your keyboard shortcut also works.`
        : 'Add a mouse trigger alongside your keyboard shortcut.'}
    </span>
    {error && <span role="alert" style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</span>}
  </div>
}
