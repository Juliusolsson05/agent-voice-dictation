import type { AudioLevelSample } from './types.js'

export type AudioLevelMeter = {
  start(onSample: (sample: AudioLevelSample) => void): void
  stop(): void
}

export function createAudioLevelMeter(
  stream: MediaStream,
  opts: { fftSize?: number; intervalMs?: number } = {},
): AudioLevelMeter {
  const audioContext = new AudioContext()
  const analyser = audioContext.createAnalyser()
  analyser.fftSize = opts.fftSize ?? 1024
  const source = audioContext.createMediaStreamSource(stream)
  source.connect(analyser)
  const data = new Float32Array(analyser.fftSize)
  let timer: number | null = null

  return {
    start(onSample) {
      const intervalMs = opts.intervalMs ?? 60
      timer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(data)
        let sum = 0
        let peak = 0
        for (const value of data) {
          sum += value * value
          peak = Math.max(peak, Math.abs(value))
        }
        onSample({
          rms: Math.sqrt(sum / data.length),
          peak,
          timestampMs: Date.now(),
        })
      }, intervalMs)
    },
    stop() {
      if (timer !== null) window.clearInterval(timer)
      source.disconnect()
      void audioContext.close()
    },
  }
}
