import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { get } from 'node:https'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { PhoneMicServer } from './server'
import type { PhoneEvent } from '../../shared/phoneMic'
import { phoneScript } from './pages'

let server: PhoneMicServer, directory = ''
const sockets: WebSocket[] = []
afterEach(async () => { sockets.forEach(ws => ws.terminate()); sockets.length = 0; await server?.stop(); if (directory) await rm(directory, { recursive: true, force: true }) })

it('requires trusted TLS, origin and pairing; relays only signaling and clears ownership on disconnect', async () => {
  directory = await mkdtemp(join(tmpdir(), 'agent-voice-phone-test-'))
  const events: PhoneEvent[] = []
  server = new PhoneMicServer(directory, () => {}, event => events.push(event))
  const state = await server.start(['127.0.0.1'], '127.0.0.1')
  const setup = new URL(state.urls[0])
  const html = await (await fetch(setup)).text()
  const securePort = html.match(/location.hostname\+':(\d+)\//)![1]
  const ca = await readFile(join(directory, 'ca.pem'))
  const origin = `https://127.0.0.1:${securePort}`
  const page = await new Promise<string>((resolve, reject) => { get(origin, { ca }, res => { let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve(body)) }).on('error', reject) })
  expect(page).toContain('Connect microphone')
  expect(page).not.toContain(setup.hash.slice(1))
  const connection = async (suppliedOrigin = origin) => {
    const ws = new WebSocket(`wss://127.0.0.1:${securePort}/signal`, { ca, origin: suppliedOrigin }); sockets.push(ws)
    ws.on('error', () => {})
    await once(ws, 'open'); return ws
  }
  await expect(connection('https://attacker.example')).rejects.toThrow()
  const wrong = await connection(); const rejected = once(wrong, 'close'); wrong.send(JSON.stringify({ type: 'pair', token: 'wrong' })); await rejected
  expect(server.snapshot().connected).toBe(false)
  const phone = await connection(); const paired = once(phone, 'message'); phone.send(JSON.stringify({ type: 'pair', token: setup.hash.slice(1) })); await paired
  expect(server.snapshot().connected).toBe(true)
  await expect(connection()).rejects.toThrow()
  phone.send(JSON.stringify({ type: 'offer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' }))
  await new Promise(resolve => setTimeout(resolve, 30))
  expect(events).toHaveLength(1)
  const id = events[0].id
  server.receiverState('stale', true, 1)
  expect(server.snapshot().ready).toBe(false)
  server.receiverState(id, true, 0.6)
  expect(server.snapshot().level).toBe(0.6)
  const response = once(phone, 'message'); server.send(id, { type: 'answer', sdp: 'm=audio 9 RTP/AVP 0' }); expect(JSON.parse((await response)[0].toString()).type).toBe('answer')
  const closed = once(phone, 'close'); phone.close(); await closed
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(server.snapshot().ready).toBe(false)
  expect(events.at(-1)).toEqual({ id, disconnected: true })
  const originalFingerprint = state.fingerprint
  await server.stop()
  const restarted = await server.start(['127.0.0.1'], '127.0.0.1')
  expect(restarted.fingerprint).toBe(originalFingerprint)
  expect(restarted.urls[0]).not.toBe(state.urls[0])
}, 20000)

it('ships syntactically valid phone JavaScript without provider keys or remote scripts', () => {
  expect(() => new Function(phoneScript)).not.toThrow()
  expect(phoneScript).toContain('iceServers:[]')
  expect(phoneScript).not.toMatch(/deepgram|apiKey|stun:|turn:/)
})
