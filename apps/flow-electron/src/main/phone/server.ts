import { createServer as httpServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as httpsServer } from 'node:https'
import { networkInterfaces } from 'node:os'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'
import { emptyPhoneStatus, validPhoneSignal, type PhoneStatus, type PhoneEvent, type PhoneSignal } from '../../shared/phoneMic'
import { phoneCertificates } from './certificates'
import { setupPage, microphonePage, phoneScript } from './pages'

export function lanAddresses(): string[] {
  return [...new Set(Object.entries(networkInterfaces()).filter(([name]) => !/^(utun|tun|ppp|ipsec)/.test(name))
    .flatMap(([, entries]) => (entries ?? []).filter(entry => entry.family === 'IPv4' && !entry.internal &&
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address)).map(entry => entry.address)))]
}

async function listen(server: Server, port: number, host: string): Promise<number> {
  // Prefer predictable ports for manually entered phone links. If another app
  // owns the port, let the OS pick one; never terminate an unrelated listener.
  const attempt = (port: number) => new Promise<number>((resolve, reject) => {
    const error = (err: Error) => reject(err)
    server.once('error', error)
    server.listen(port, host, () => { server.off('error', error); resolve((server.address() as { port: number }).port) })
  })
  try { return await attempt(port) } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err
    return attempt(0)
  }
}

export class PhoneMicServer {
  private status = emptyPhoneStatus()
  private http?: Server
  private https?: Server
  private wss?: WebSocketServer
  private socket?: WebSocket
  private id = ''
  private token = ''
  private heartbeat?: ReturnType<typeof setInterval>
  private starting?: Promise<PhoneStatus>
  constructor(private directory: string, private onStatus: (status: PhoneStatus) => void, private onSignal: (event: PhoneEvent) => void) {}
  snapshot(): PhoneStatus { return { ...this.status, urls: [...this.status.urls] } }
  private emit(patch: Partial<PhoneStatus>) { this.status = { ...this.status, ...patch }; this.onStatus(this.snapshot()) }

  start(addresses = lanAddresses(), bindHost = '0.0.0.0'): Promise<PhoneStatus> {
    if (this.starting) return this.starting
    if (this.status.running) return Promise.resolve(this.snapshot())
    this.starting = this.startInternal(addresses, bindHost).finally(() => { this.starting = undefined })
    return this.starting
  }
  private async startInternal(addresses: string[], bindHost: string) {
    if (!addresses.length) throw new Error('No private Wi-Fi or Ethernet address found. Connect to your local network first.')
    try {
      const tls = await phoneCertificates(this.directory, addresses)
      this.token = randomBytes(32).toString('hex')
      let securePort = 0
      const hosts = new Set(addresses)
      const respond = (secure: boolean) => (req: IncomingMessage, res: ServerResponse) => {
        const hostname = req.headers.host?.split(':')[0]
        // Host validation prevents a malicious public domain from rebinding to
        // this listener and reading the bootstrap page/certificate as its origin.
        if (!hostname || !hosts.has(hostname)) { res.writeHead(403).end(); return }
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.setHeader('Referrer-Policy', 'no-referrer')
        res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
        res.setHeader('Permissions-Policy', 'microphone=(self), camera=()')
        if (req.method !== 'GET') { res.writeHead(405).end(); return }
        if (!secure && req.url === '/ca.cer') { res.setHeader('Content-Type', 'application/x-x509-ca-cert'); res.setHeader('Content-Disposition', 'attachment; filename="Agent-Voice-Phone.cer"'); res.end(tls.ca); return }
        if (secure && req.url === '/phone.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(phoneScript); return }
        if (req.url !== '/') { res.writeHead(404).end(); return }
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(secure ? microphonePage : setupPage(securePort, tls.fingerprint))
      }
      this.https = httpsServer({ key: tls.key, cert: tls.cert, minVersion: 'TLSv1.2' }, respond(true))
      securePort = await listen(this.https, 43124, bindHost)
      this.http = httpServer(respond(false))
      const setupPort = await listen(this.http, 43123, bindHost)
      this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false })
      this.https.on('upgrade', (req, socket, head) => {
        if (req.url !== '/signal' || !addresses.some(ip => req.headers.origin === `https://${ip}:${securePort}`) || req.headers.origin !== `https://${req.headers.host}` || this.socket || (this.wss?.clients.size ?? 0) >= 8) { socket.destroy(); return }
        this.wss!.handleUpgrade(req, socket, head, ws => this.accept(ws))
      })
      for (const server of [this.http, this.https]) {
        server.requestTimeout = 10000; server.headersTimeout = 10000
        server.on('error', () => this.emit({ error: 'Phone server encountered a network error. Stop and start it again.' }))
      }
      this.emit({ running: true, urls: addresses.map(ip => `http://${ip}:${setupPort}/#${this.token}`), fingerprint: tls.fingerprint, error: null })
      return this.snapshot()
    } catch (err) { this.close(); throw err }
  }
  private accept(ws: WebSocket) {
    let authenticated = false, count = 0, windowStart = Date.now(), alive = true
    const timeout = setTimeout(() => ws.terminate(), 5000)
    ws.on('error', () => ws.terminate())
    ws.on('pong', () => { alive = true })
    ws.on('message', (bytes, binary) => {
      try {
        if (binary) throw new Error('No binary signaling')
        if (Date.now() - windowStart > 1000) { count = 0; windowStart = Date.now() }
        if (++count > 100) throw new Error('Too many signaling messages')
        const message = JSON.parse(bytes.toString())
        if (!authenticated) {
          const candidate = Buffer.from(typeof message?.token === 'string' ? message.token : '')
          const expected = Buffer.from(this.token)
          if (message?.type !== 'pair' || candidate.length !== expected.length || !timingSafeEqual(candidate, expected) || this.socket || !this.status.running) throw new Error('Invalid pairing')
          authenticated = true; clearTimeout(timeout); this.socket = ws; this.id = randomUUID()
          this.emit({ connected: true, ready: false, error: null })
          ws.send(JSON.stringify({ type: 'paired' }))
          this.heartbeat = setInterval(() => { if (!alive) { ws.terminate(); return }; alive = false; ws.ping() }, 5000)
          return
        }
        if (!validPhoneSignal(message)) throw new Error('Invalid signaling')
        this.onSignal({ id: this.id, signal: message })
      } catch { ws.close(1008, 'Pairing or signaling rejected') }
    })
    ws.on('close', () => {
      clearTimeout(timeout)
      if (this.socket !== ws) return
      clearInterval(this.heartbeat); this.socket = undefined
      this.onSignal({ id: this.id, disconnected: true })
      this.id = ''
      this.emit({ connected: false, ready: false, level: 0 })
    })
  }
  send(id: string, signal: PhoneSignal) {
    if (id === this.id && validPhoneSignal(signal, false) && this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(signal))
  }
  receiverState(id: string, ready: boolean, level: number, error?: string) {
    if (!id || id !== this.id) return
    this.emit({ ready: ready === true, level: Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0, error: error ? String(error).slice(0, 200) : null })
  }
  disconnect() { this.socket?.terminate() }
  async stop() { await this.starting?.catch(() => {}); this.close(); return this.snapshot() }
  close() {
    clearInterval(this.heartbeat)
    if (this.id) this.onSignal({ id: this.id, disconnected: true })
    this.id = ''; this.socket = undefined; this.token = ''
    for (const client of this.wss?.clients ?? []) client.terminate()
    this.wss?.close(); this.wss = undefined
    for (const server of [this.http, this.https]) { server?.closeAllConnections(); server?.close() }
    this.http = undefined; this.https = undefined
    this.status = emptyPhoneStatus(); this.onStatus(this.snapshot())
  }
}
