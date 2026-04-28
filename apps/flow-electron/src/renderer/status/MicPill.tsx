// MicPill renders the floating dictation indicator.
//
// Two visual variants:
//   - hands-free: pill with [X] cancel + waveform + [■] stop
//   - hold-to-talk: pill with waveform only, no buttons
//
// The pill is the only thing this window paints. The window background
// is transparent (see status/index.html body class), so the pill's
// rounded shape sits directly over whatever app is underneath.

type State = 'idle' | 'recording' | 'transcribing' | 'error'

type Props = {
  state: State
  levels: number[]
  error: string | null
  handsFree: boolean
  visible: boolean
  onStop: () => void
  onCancel: () => void
}

export function MicPill({ state, levels, error, handsFree, visible, onStop, onCancel }: Props) {
  return (
    <div style={shellStyle}>
      <div
        style={{
          ...pillStyle,
          background: state === 'error' ? 'var(--danger)' : 'var(--surface)',
          borderColor: state === 'error' ? 'var(--danger)' : 'var(--border-soft)',
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.94)',
        }}
        title={error ?? undefined}
      >
        {handsFree && state !== 'error' && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            style={leftButtonStyle}
          >
            <CrossIcon />
          </button>
        )}

        <div style={waveStyle}>
          {state === 'transcribing' ? (
            <DotsAnimating />
          ) : state === 'error' ? (
            <span style={errorTextStyle}>
              {shortError(error)}
            </span>
          ) : (
            <Bars levels={levels} active={state === 'recording'} />
          )}
        </div>

        {handsFree && state !== 'error' && (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop"
            style={stopButtonStyle}
          >
            <StopIcon />
          </button>
        )}
      </div>
    </div>
  )
}

function Bars({ levels, active }: { levels: number[]; active: boolean }) {
  // The bars are no longer decorative clones of one level. Each value is a
  // speech-frequency band from the active mic stream, with the sine curve only
  // adding a small organic bend. If the room is quiet, the bars should be calm;
  // if consonants spike in the high bands, the right-side bars should react.
  const phases = [0, 0.11, 0.23, 0.37, 0.52, 0.68, 0.84]
  const t = (Date.now() % 700) / 700
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, height: 20 }}>
      {phases.map((phase, i) => {
        const voice = levels[i] ?? 0
        const wave = active ? 0.86 + 0.14 * Math.abs(Math.sin((t + phase) * Math.PI * 2)) : 1
        const responsive = active ? Math.max(voice, 0.025) * wave : 0.02
        const h = Math.max(3, Math.round(responsive * 18))
        return (
          <span
            key={i}
            style={{
              width: 3,
              height: h,
              opacity: active ? 0.62 + Math.min(0.38, voice * 0.7) : 0.5,
              background: active ? 'var(--accent)' : 'var(--ink-mute)',
              borderRadius: 2,
              transition: 'height 28ms linear',
            }}
          />
        )
      })}
    </div>
  )
}

function shortError(error: string | null): string {
  if (!error) return 'error'
  if (error.includes('No API key')) return 'missing key'
  if (error.includes('No audio')) return 'no audio'
  if (error.includes('Permission')) return 'permission'
  return 'error'
}

function DotsAnimating() {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {[0, 1, 2].map(i => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--ink-dim)',
            animation: `flow-pulse 1.1s ${i * 0.18}s ease-in-out infinite`,
          }}
        />
      ))}
      <style>{`@keyframes flow-pulse { 0%,80%,100%{opacity:.2;transform:scale(.85)} 40%{opacity:1;transform:scale(1)} }`}</style>
    </div>
  )
}

function CrossIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 3 L9 9 M9 3 L3 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="1.5" y="1.5" width="7" height="7" rx="1.2" fill="currentColor" />
    </svg>
  )
}

const shellStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  // The whole window is draggable so the user can reposition the pill.
  // Buttons explicitly opt out via WebkitAppRegion: no-drag below.
  WebkitAppRegion: 'drag',
} as React.CSSProperties

const pillStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 12px',
  borderRadius: 999,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  // Keep the indicator visually quiet. A large shadow reads like a dark arc
  // around the waveform on transparent windows, especially over bright apps.
  // The waveform itself is the state indicator; the pill chrome should recede.
  boxShadow: 'none',
  minWidth: 130,
  height: 36,
  transition: 'opacity 130ms ease, transform 150ms cubic-bezier(.2,.8,.2,1), border-color 120ms ease',
}

const waveStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 18,
}

const errorTextStyle: React.CSSProperties = {
  color: 'white',
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  maxWidth: 92,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const leftButtonStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: '50%',
  border: 'none',
  background: 'var(--surface-2)',
  color: 'var(--ink-dim)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  WebkitAppRegion: 'no-drag',
} as React.CSSProperties

const stopButtonStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: '50%',
  border: 'none',
  background: 'var(--danger)',
  color: 'white',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  WebkitAppRegion: 'no-drag',
} as React.CSSProperties
