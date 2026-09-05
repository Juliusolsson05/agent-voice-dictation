import { useEffect, useState } from 'react'

export function ShortcutStatus() {
  const [status, setStatus] = useState<{ running: boolean; error: string | null; lastPressAt: number | null } | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false
    const refresh = async () => {
      try { const next = await window.flow.hotkeys.status(); if (!disposed) setStatus(next) }
      catch { if (!disposed) setError('Could not read shortcut listener status.') }
    }
    void refresh()
    // Poll protocol state, never raw key/mouse events or typed content. This
    // distinguishes a dead native helper from a microphone that cannot open.
    const timer = setInterval(() => { void refresh() }, 1000)
    return () => { disposed = true; clearInterval(timer) }
  }, [])
  if (window.flow.app.platform !== 'darwin') return null
  return <div style={{ padding: 12, marginBottom: 16, border: '1px solid var(--border)', borderRadius: 8 }}>
    <div role="status" aria-label="Shortcut listener status">
      {status?.running ? 'Keyboard and mouse listener is active.' : status?.error || 'Checking shortcut listener…'}
    </div>
    <p style={{ fontSize: 12, margin: '8px 0' }}>
      {status?.lastPressAt ? `Last shortcut received: ${new Date(status.lastPressAt).toLocaleTimeString()}`
        : 'No shortcut received since launch. Hold your shortcut to check.'}
      {' '}Microphone availability is shown below.
    </p>
    <button type="button" className="btn" disabled={retrying} onClick={async () => {
      setRetrying(true); setError('')
      try { await window.flow.hotkeys.retry(); setStatus(await window.flow.hotkeys.status()) }
      catch { setError('Could not restart shortcuts.') }
      finally { setRetrying(false) }
    }}>{retrying ? 'Restarting…' : 'Retry shortcuts'}</button>
    {error && <div role="alert">{error}</div>}
  </div>
}
