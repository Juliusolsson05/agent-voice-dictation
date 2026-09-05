import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { X509Certificate } from 'node:crypto'
const exec = promisify(execFile)

export async function phoneCertificates(directory: string, addresses: string[]) {
  // A per-installation CA avoids shipping a shared private key. Nothing is
  // installed into the Mac trust store. iOS trust is explicitly performed by
  // the owner; Node/Chromium certificate validation is never disabled.
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  const path = (name: string) => join(directory, name)
  const openssl = process.platform === 'darwin' ? '/usr/bin/openssl' : 'openssl'
  const run = async (...args: string[]) => { await exec(openssl, args, { cwd: directory, timeout: 20000 }) }
  try { await readFile(path('ca.pem')); await readFile(path('ca.key')) } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    await writeFile(path('ca.cnf'), '[req]\ndistinguished_name=dn\nx509_extensions=ca\nprompt=no\n[dn]\nCN=Agent Voice Phone Microphone\n[ca]\nbasicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n', { mode: 0o600 })
    await run('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '3650', '-keyout', 'ca.key', '-out', 'ca.pem', '-config', 'ca.cnf')
    await chmod(path('ca.key'), 0o600)
  }
  // Renew the leaf on every server start so changing Wi-Fi/IP needs no new CA
  // installation. Only validated IPv4 literals enter this OpenSSL config.
  if (addresses.some(address => !/^\d{1,3}(\.\d{1,3}){3}$/.test(address))) throw new Error('Invalid LAN address')
  await writeFile(path('leaf.cnf'), `[leaf]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=${['127.0.0.1', ...addresses].map(ip => `IP:${ip}`).join(',')}\n`, { mode: 0o600 })
  await run('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-subj', '/CN=Agent Voice LAN Microphone', '-keyout', 'server.key', '-out', 'server.csr')
  await chmod(path('server.key'), 0o600)
  await run('x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-days', '30', '-sha256', '-extfile', 'leaf.cnf', '-extensions', 'leaf', '-out', 'server.pem')
  const ca = await readFile(path('ca.pem'))
  return { key: await readFile(path('server.key')), cert: await readFile(path('server.pem')), ca: new X509Certificate(ca).raw, fingerprint: new X509Certificate(ca).fingerprint256 }
}
