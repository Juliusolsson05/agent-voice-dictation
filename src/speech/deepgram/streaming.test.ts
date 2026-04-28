import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chooseDeepgramStreamingTranscriptText } from './streaming.js'

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
