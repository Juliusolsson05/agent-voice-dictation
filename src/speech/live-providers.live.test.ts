import { existsSync, readFileSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { transcribeAssemblyAi } from './assemblyai/index.js'
import { transcribeDeepgram } from './deepgram/index.js'
import { transcribeElevenLabs } from './elevenlabs/index.js'
import { transcribeGladia } from './gladia/index.js'
import { transcribeOpenAi } from './openai/index.js'
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

const DEFAULT_AUDIO_FIXTURE = 'test/fixtures/audio/provider-smoke.wav'
const audioPath = process.env.STT_TEST_AUDIO_FILE ?? DEFAULT_AUDIO_FIXTURE
const configuredProviders = liveProviders
  .map(provider => ({ provider, apiKey: readFirstEnv(provider.envNames) }))
  .filter((entry): entry is { provider: LiveProvider; apiKey: string } => Boolean(entry.apiKey))

describe.skipIf(process.env.STT_LIVE_TEST !== '1')('live STT providers', () => {
  it('has an explicit readable audio fixture', () => {
    expect(existsSync(resolve(audioPath))).toBe(true)
  })

  it('has at least one explicitly configured provider credential', () => {
    // WHY ambient .env loading is forbidden here: merely having a developer
    // secret on disk used to make the default suite perform billable network
    // calls. A live invocation now requires both STT_LIVE_TEST=1 and a key
    // already exported by the caller.
    expect(configuredProviders.length).toBeGreaterThan(0)
  })

  for (const provider of liveProviders) {
    const apiKey = readFirstEnv(provider.envNames)
    it.skipIf(apiKey === undefined)(
      `${provider.id} transcribes the shared prerecorded audio`,
      async () => {
        const transcript = await provider.transcribe(apiKey!, readAudioFile(audioPath))
        const text = transcript.text.trim()

        expect(transcript.provider).toBe(provider.id)
        expect(text.length, `${provider.id} returned an empty transcript`).toBeGreaterThan(0)
      },
      Number(process.env.STT_TEST_TIMEOUT_MS ?? 180_000),
    )
  }
})

function readAudioFile(filePath: string): AudioInput {
  const absolutePath = resolve(filePath)
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
