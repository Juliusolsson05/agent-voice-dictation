import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WebSocketServer } from 'ws'
import { chooseDeepgramStreamingTranscriptText, createDeepgramStreamingProvider } from './streaming.js'

test('Deepgram streaming prefers a longer interim tail over an older final fragment', () => {
  const selected = chooseDeepgramStreamingTranscriptText(
    'What are you doing?',
    'What are you doing? Can we please figure out from the logs why the last ten seconds get lost at the end of the transcription.',
  )

  assert.equal(selected.source, 'interim')
  assert.equal(
    selected.text,
    'What are you doing? Can we please figure out from the logs why the last ten seconds get lost at the end of the transcription.',
  )
})

test('Deepgram streaming still prefers final text when it is the most complete candidate', () => {
  const selected = chooseDeepgramStreamingTranscriptText(
    'Please fix the dictation tail.',
    'Please fix the dictation tail.',
  )

  assert.deepEqual(selected, {
    text: 'Please fix the dictation tail.',
    source: 'final',
  })
})

test('Deepgram streaming combines distinct turns when neither contains the other', () => {
  // Multi-turn Flux scenario: the user spoke turn A, paused so Flux emitted
  // EndOfTurn for it, then started turn B. At stop time `finalText` is from
  // turn A and `interimText` is from turn B; before this fix the longer one
  // won and the other was silently lost. Specifically the case from the cc-shell
  // trace: final = "...I want to do is to add so that" (53 chars), interim =
  // "You know, in the settings in the last application," (50 chars). Old code
  // returned final alone and the user saw their entire latest sentence
  // disappear at commit. The fix surfaces both, finals first.
  const finalText = 'Something I want to do is to add so that'
  const interimText = 'You know, in the settings in the last application,'

  const selected = chooseDeepgramStreamingTranscriptText(finalText, interimText)

  assert.equal(selected.source, 'final')
  assert.equal(selected.text, `${finalText} ${interimText}`)
})

test('Deepgram streaming returns final alone when interim is already covered by it', () => {
  // The early-finalize path can land a final whose text already contains the
  // last interim that triggered it. Concatenating in that case would
  // duplicate the trailing tokens.
  const selected = chooseDeepgramStreamingTranscriptText(
    'Please fix the dictation tail with care.',
    'Please fix the dictation tail',
  )

  assert.equal(selected.source, 'final')
  assert.equal(selected.text, 'Please fix the dictation tail with care.')
})

test('Deepgram streaming emits cumulative interim text across multiple turns', async () => {
  // Reproduces the cc-shell "previous sentence vanishes mid-recording" report.
  // Flux's per-event `transcript` field is the CURRENT turn only — see
  // https://developers.deepgram.com/docs/flux/state — so when a turn closes
  // and the next turn's first Update lands, naive forwarding would replace
  // everything the user has said so far with just the new turn's first word.
  // The interim onTranscript callback must instead emit `finals + currentTurn`
  // so the host's preview stays stable across the EndOfTurn boundary.
  const server = new WebSocketServer({ port: 0 })
  const address = server.address()
  assert(address && typeof address === 'object')
  const baseUrl = `ws://127.0.0.1:${address.port}/listen`
  const events: Array<{ text: string; isFinal: boolean; source: string }> = []

  server.on('connection', socket => {
    // Turn 0: a few interim updates and an EndOfTurn that finalizes turn 0.
    socket.send(JSON.stringify({
      type: 'TurnInfo',
      event: 'StartOfTurn',
      turn_index: 0,
      transcript: 'first sentence',
    }))
    socket.send(JSON.stringify({
      type: 'TurnInfo',
      event: 'EndOfTurn',
      turn_index: 0,
      transcript: 'first sentence about the project',
    }))
    // Turn 1: the user resumes after a pause. Flux now sends only the new
    // turn's words. Without the cumulative-interim fix, a host wired to the
    // raw transcript would erase "first sentence about the project" the
    // moment this lands.
    socket.send(JSON.stringify({
      type: 'TurnInfo',
      event: 'Update',
      turn_index: 1,
      transcript: 'second sentence',
    }))
    socket.on('message', data => {
      if (data.toString() === JSON.stringify({ type: 'CloseStream' })) {
        socket.close()
      }
    })
  })

  try {
    const provider = createDeepgramStreamingProvider({ baseUrl })
    const started = provider.start({
      apiKey: 'test-key',
      onTranscript: event => events.push({
        text: event.text,
        isFinal: event.isFinal,
        source: event.source,
      }),
    })
    provider.pushChunk(started.id, new Uint8Array([1, 2, 3]))
    await provider.stop(started.id)

    // The exact final-event ordering depends on Flux's StartOfTurn handling
    // (StartOfTurn is treated as interim because event !== 'EndOfTurn'). The
    // load-bearing assertion is that the first interim seen during turn 1
    // includes BOTH turn 0's final AND turn 1's words.
    const turn1Interim = events.find(e => e.source === 'interim' && e.text.includes('second sentence'))
    assert.ok(turn1Interim, 'expected an interim event for turn 1')
    assert.equal(
      turn1Interim?.text,
      'first sentence about the project second sentence',
      'turn 1 interim should carry turn 0 final + current turn words, not turn 1 alone',
    )
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test('Deepgram streaming emits live transcript callbacks before stop resolves', async () => {
  const server = new WebSocketServer({ port: 0 })
  const address = server.address()
  assert(address && typeof address === 'object')
  const baseUrl = `ws://127.0.0.1:${address.port}/listen`
  const events: Array<{ text: string; isFinal: boolean; source: string }> = []
  let requestUrl = ''

  server.on('connection', (socket, request) => {
    requestUrl = request.url ?? ''
    socket.on('message', data => {
      if (data.toString() === JSON.stringify({ type: 'CloseStream' })) {
        socket.send(JSON.stringify({
          type: 'Results',
          is_final: true,
          channel: { alternatives: [{ transcript: 'hello world' }] },
        }))
        socket.close()
      }
    })
    socket.send(JSON.stringify({
      type: 'Results',
      is_final: false,
      channel: { alternatives: [{ transcript: 'hello' }] },
    }))
  })

  try {
    const provider = createDeepgramStreamingProvider({ baseUrl })
    const started = provider.start({
      apiKey: 'test-key',
      onTranscript: event => events.push({
        text: event.text,
        isFinal: event.isFinal,
        source: event.source,
      }),
    })
    provider.pushChunk(started.id, new Uint8Array([1, 2, 3]))
    const transcript = await provider.stop(started.id)

    const url = new URL(requestUrl, baseUrl)
    assert.equal(url.searchParams.get('model'), 'flux-general-en')
    assert.equal(
      url.searchParams.has('interim_results'),
      false,
      'Flux v2 rejects the v1 interim_results query parameter; TurnInfo updates stream without it',
    )
    assert.equal(transcript.text, 'hello world')
    assert.deepEqual(events, [
      { text: 'hello', isFinal: false, source: 'interim' },
      { text: 'hello world', isFinal: true, source: 'final' },
    ])
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
