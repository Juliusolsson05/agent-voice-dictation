import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { test } from 'node:test'
import { transcribeAssemblyAi } from './assemblyai.js'
import { transcribeDeepgram } from './deepgram.js'
import { transcribeElevenLabs } from './elevenlabs.js'
import { transcribeGladia } from './gladia.js'
import { transcribeOpenAi } from './openai.js'
import type { AudioInput, SpeechProviderId, SpeechTranscript } from './types.js'

type LiveProvider = {
  id: SpeechProviderId
  envNames: string[]
  transcribe(apiKey: string, audio: AudioInput): Promise<SpeechTranscript>
}

const liveProviders: LiveProvider[] = [
  {
    id: 'assemblyai',
    envNames: ['ASSEMBLYAI_API_KEY', 'ASSEMBLY_AI_API_KEY'],
    transcribe: (apiKey, audio) => transcribeAssemblyAi({ pollIntervalMs: 750 }, { apiKey, audio }),
  },
  {
    id: 'deepgram',
    envNames: ['DEEPGRAM_API_KEY'],
    transcribe: (apiKey, audio) => transcribeDeepgram({}, { apiKey, audio }),
  },
  {
    id: 'openai',
    envNames: ['OPENAI_API_KEY'],
    transcribe: (apiKey, audio) => transcribeOpenAi({}, { apiKey, audio }),
  },
  {
    id: 'gladia',
    envNames: ['GLADIA_API_KEY'],
    transcribe: (apiKey, audio) => transcribeGladia({ pollIntervalMs: 750 }, { apiKey, audio }),
  },
  {
    id: 'elevenlabs',
    envNames: ['ELEVENLABS_API_KEY', 'ELEVEN_LABS_API_KEY'],
    transcribe: (apiKey, audio) => transcribeElevenLabs({}, { apiKey, audio }),
  },
]

loadDotEnv()

const audioPath = process.env.STT_TEST_AUDIO_FILE
const configuredProviders = liveProviders
  .map(provider => ({ provider, apiKey: readFirstEnv(provider.envNames) }))
  .filter((entry): entry is { provider: LiveProvider; apiKey: string } => Boolean(entry.apiKey))

test('live STT providers transcribe the same prerecorded audio', {
  skip: skipReason(),
  timeout: Number(process.env.STT_TEST_TIMEOUT_MS ?? 180_000),
}, async t => {
  const audio = readAudioFile(audioPath as string)

  for (const { provider, apiKey } of configuredProviders) {
    await t.test(provider.id, async () => {
      const transcript = await provider.transcribe(apiKey, audio)
      const text = transcript.text.trim()

      assert.equal(transcript.provider, provider.id)
      assert.ok(text.length > 0, `${provider.id} returned an empty transcript`)
      console.log(`[stt:live] ${provider.id}: ${text.slice(0, 160)}`)
    })
  }
})

function skipReason(): string | false {
  if (!audioPath) {
    return 'Set STT_TEST_AUDIO_FILE=/absolute/or/relative/audio.wav to run live STT provider checks.'
  }
  if (!existsSync(resolve(audioPath))) {
    return `STT_TEST_AUDIO_FILE does not exist: ${audioPath}`
  }
  if (!configuredProviders.length) {
    return 'No STT provider API keys are configured in .env or the shell environment.'
  }
  return false
}

function readAudioFile(filePath: string): AudioInput {
  const absolutePath = resolve(filePath)

  // The live test intentionally feeds every provider the exact same bytes. That
  // catches provider-specific drift in request construction without mixing in
  // browser MediaRecorder behavior, Electron IPC, or microphone permissions.
  return {
    data: readFileSync(absolutePath),
    mimeType: mimeTypeForPath(absolutePath),
    filename: basename(absolutePath),
  }
}

function mimeTypeForPath(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.mp3':
      return 'audio/mpeg'
    case '.m4a':
    case '.mp4':
      return 'audio/mp4'
    case '.ogg':
    case '.oga':
      return 'audio/ogg'
    case '.wav':
      return 'audio/wav'
    case '.webm':
      return 'audio/webm'
    default:
      return 'application/octet-stream'
  }
}

function readFirstEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return undefined
}

function loadDotEnv(): void {
  for (const filePath of [resolve('.env'), resolve('../.env')]) {
    if (!existsSync(filePath)) continue

    // Tests should work from the package root and from app subdirectories. This
    // tiny parser is enough for our checked-in key convention and avoids adding
    // dotenv as another runtime dependency for a package whose provider clients
    // otherwise have no Node-only dependencies.
    for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed)
      if (!match) continue

      const [, key, rawValue] = match
      process.env[key] ??= rawValue.replace(/^['"]|['"]$/g, '')
    }
  }
}
