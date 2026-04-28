import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { transcribeAssemblyAi } from './assemblyai.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('AssemblyAI transcript creation uses current speech_models array field', async () => {
  const transcriptBodies: unknown[] = []

  globalThis.fetch = (async (url, init) => {
    const target = String(url)

    if (target.endsWith('/v2/upload')) {
      return jsonResponse({ upload_url: 'https://uploads.example/audio.webm' })
    }

    if (target.endsWith('/v2/transcript') && init?.method === 'POST') {
      transcriptBodies.push(JSON.parse(String(init.body)))
      return jsonResponse({ id: 'transcript-1' })
    }

    if (target.endsWith('/v2/transcript/transcript-1')) {
      return jsonResponse({
        id: 'transcript-1',
        status: 'completed',
        text: 'hello world',
      })
    }

    throw new Error(`Unexpected fetch: ${target}`)
  }) as typeof fetch

  await transcribeAssemblyAi({ pollIntervalMs: 0 }, {
    apiKey: 'test-key',
    audio: {
      data: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/webm',
    },
  })

  assert.equal(transcriptBodies.length, 1)
  assert.deepEqual(transcriptBodies[0], {
    audio_url: 'https://uploads.example/audio.webm',
    speech_models: ['universal-3-pro', 'universal-2'],
    language_detection: true,
    speaker_labels: false,
  })
  assert.equal(Object.hasOwn(transcriptBodies[0] as Record<string, unknown>, 'speech_model'), false)
})

test('AssemblyAI keeps caller-provided speech model priority order', async () => {
  const transcriptBodies: unknown[] = []

  globalThis.fetch = (async (url, init) => {
    const target = String(url)

    if (target.endsWith('/v2/upload')) {
      return jsonResponse({ upload_url: 'https://uploads.example/audio.webm' })
    }

    if (target.endsWith('/v2/transcript') && init?.method === 'POST') {
      transcriptBodies.push(JSON.parse(String(init.body)))
      return jsonResponse({ id: 'transcript-2' })
    }

    if (target.endsWith('/v2/transcript/transcript-2')) {
      return jsonResponse({
        id: 'transcript-2',
        status: 'completed',
        text: 'hello world',
      })
    }

    throw new Error(`Unexpected fetch: ${target}`)
  }) as typeof fetch

  await transcribeAssemblyAi({
    pollIntervalMs: 0,
    speechModels: ['custom-primary', 'custom-fallback'],
  }, {
    apiKey: 'test-key',
    audio: {
      data: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/webm',
    },
  })

  assert.deepEqual((transcriptBodies[0] as Record<string, unknown>).speech_models, [
    'custom-primary',
    'custom-fallback',
  ])
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
  })
}
