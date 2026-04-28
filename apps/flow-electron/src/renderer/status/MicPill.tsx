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
  level: number
  error: string | null
  handsFree: boolean
  onStop: () => void
  onCancel: () => void
}

export function MicPill({ state, level, error, handsFree, onStop, onCancel }: Props) {
  return (
    <div style={shellStyle}>
      <div
        style={{
          ...pillStyle,
          background: state === 'error' ? 'var(--danger)' : 'var(--surface)',
          borderColor:
            state === 'recording' ? 'var(--accent)' :
            state === 'error' ? 'var(--danger)' :
            'var(--border)',
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
            <Bars level={level} active={state === 'recording'} />
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

function Bars({ level, active }: { level: number; active: boolean }) {
  // Keep the pleasant sine-wave feel, but make the mic level the amplitude
  // source. The earlier shimmer could move even when the meter was flat, which
  // made it feel detached from speech. This version only lets the sine curve
  // shape real energy that came from the microphone.
  const weights = [0.45, 0.75, 1, 0.7, 0.5]
  const phases = [0, 0.17, 0.34, 0.51, 0.68]
  const t = (Date.now() % 700) / 700
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, height: 18 }}>
      {weights.map((weight, i) => {
        const wave = active ? 0.7 + 0.3 * Math.abs(Math.sin((t + phases[i]) * Math.PI * 2)) : 1
        const responsive = active ? Math.max(level, 0.08) * weight * wave : 0.04
        const h = Math.max(3, Math.round(responsive * 18))
        return (
          <span
            key={i}
            style={{
              width: 3,
              height: h,
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
  boxShadow: 'var(--shadow-modal)',
  minWidth: 130,
  height: 36,
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
