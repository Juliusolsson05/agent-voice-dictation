// Open / close cues for the dictation pill.
//
// Synthesised at runtime instead of shipped as WAV/MP3 assets because the
// shape of these sounds is the design — peak gain, attack curve, frequency
// sweep — and we want those numbers visible in source and tweakable in a
// single PR. A binary asset would freeze the design behind a re-export step
// and a `git diff` that says "audio.wav changed, 1 file, 0 lines".
//
// Sound design rationale (the "satisfying smooth" the user asked for):
//
//   - Two oscillators: a sine fundamental + a sine at ~2× the frequency
//     with a 5-cent detune. A single sine reads as clinical / sterile;
//     pairing it with a slightly-detuned octave gives a soft chorus
//     warmth without becoming musical (it's still one perceived tone).
//
//   - Frequency sweep, not a static tone. Open rises (540 → 720Hz),
//     close falls (720 → 540Hz). The sweep gives the sound directional
//     "shape" — the brain reads rising pitch as opening and falling
//     pitch as closing without us having to think about it. Same trick
//     macOS uses for a lot of its UI affordances.
//
//   - Envelope: 6–8ms linear attack to avoid the click of a hard edge,
//     then exponential decay to silence. Total duration kept under 200ms
//     because longer cues start competing with the user's voice.
//
//   - Low-pass at 3.5kHz with mild Q. Sine waves alone are perceptually
//     "thin"; the filter takes the brittle edge off the high oscillator
//     and gives the cue a softer, more "organic" texture.
//
//   - Gain peak ~0.18. Loud enough to be felt, quiet enough that it
//     never competes with whatever the user is listening to (music,
//     a Zoom call, etc.). UI-affordance volume, not dialog volume.

let audioContext: AudioContext | null = null

function getContext(): AudioContext {
  // Lazy-construct on first use so the module doesn't open an audio
  // device for renderer windows that never play a sound. Reuse across
  // both cues — Chromium has a small per-tab budget for AudioContexts
  // and we already keep one open in App.tsx for the level meter.
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new AudioContext({ latencyHint: 'interactive' })
  }
  // Browsers suspend AudioContexts that were created without a user
  // gesture. The first time the user fires the dictation hotkey is a
  // user gesture as far as Chromium is concerned, so resume() unblocks
  // the context if it was suspended at construction.
  if (audioContext.state === 'suspended') {
    void audioContext.resume()
  }
  return audioContext
}

export function playOpenSound(): void {
  // Tuning history: started at 200ms / peakGain 0.18, the user reported
  // both "a little louder" and "a little longer". Bumped ~60% on both.
  // peakGain stays well under 1.0 so we never clip; the longer decay
  // gives the chirp a fuller tail without changing its character.
  scheduleChirp({
    durationMs: 320,
    startFreq: 540,
    endFreq: 720,
    peakGain: 0.30,
    attackMs: 10,
  })
}

export function playCloseSound(): void {
  // Slightly shorter and slightly quieter than open. The asymmetry is
  // intentional: opening is "I am paying attention", closing is "okay,
  // got it" — the second cue earns less of the user's attention budget.
  scheduleChirp({
    durationMs: 240,
    startFreq: 720,
    endFreq: 540,
    peakGain: 0.27,
    attackMs: 8,
  })
}

type ChirpSpec = {
  durationMs: number
  startFreq: number
  endFreq: number
  peakGain: number
  attackMs: number
}

function scheduleChirp(spec: ChirpSpec): void {
  let ctx: AudioContext
  try {
    ctx = getContext()
  } catch {
    // AudioContext construction can throw on systems with no audio
    // device (rare but happens on minimal Linux containers and some
    // CI macOS images). The cue is decorative — silently skip rather
    // than crash the renderer for "the speaker click did not happen".
    return
  }
  const now = ctx.currentTime
  const duration = spec.durationMs / 1000
  const attack = spec.attackMs / 1000

  const fundamental = ctx.createOscillator()
  fundamental.type = 'sine'
  fundamental.frequency.setValueAtTime(spec.startFreq, now)
  fundamental.frequency.exponentialRampToValueAtTime(spec.endFreq, now + duration)

  // Detune by ~5 cents (1.003 ratio) on the octave to get gentle chorus
  // warmth instead of a perfect-octave bell sound. Picked empirically:
  // 1.0 sounds "two distinct notes", 1.005 sounds "one warm note".
  const overtone = ctx.createOscillator()
  overtone.type = 'sine'
  overtone.frequency.setValueAtTime(spec.startFreq * 2.003, now)
  overtone.frequency.exponentialRampToValueAtTime(spec.endFreq * 2.003, now + duration)

  // Quieter overtone gain so the fundamental stays the perceived pitch
  // — the overtone is texture, not a second voice.
  const overtoneGain = ctx.createGain()
  overtoneGain.gain.value = 0.42

  const envelope = ctx.createGain()
  envelope.gain.setValueAtTime(0, now)
  envelope.gain.linearRampToValueAtTime(spec.peakGain, now + attack)
  // exponentialRampToValueAtTime cannot land on zero (ratio math), so
  // ramp to a tiny epsilon and treat anything below it as silence.
  envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration)

  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 3500
  filter.Q.value = 0.7

  fundamental.connect(envelope)
  overtone.connect(overtoneGain)
  overtoneGain.connect(envelope)
  envelope.connect(filter)
  filter.connect(ctx.destination)

  fundamental.start(now)
  overtone.start(now)
  // Overshoot stop time by 50ms so the exponential decay finishes
  // cleanly before the oscillators are torn down — stopping mid-decay
  // produces a faint click on some Chromium builds.
  fundamental.stop(now + duration + 0.05)
  overtone.stop(now + duration + 0.05)
}
