import { app, safeStorage } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// Encrypted-at-rest secret store for provider API keys.
//
// Why safeStorage and not just plain JSON: API keys are bearer tokens —
// anyone who copies our config file gets full billable access. macOS
// gives us Keychain-backed encryption for free via Electron's
// safeStorage. We do not roll our own crypto; rolling crypto in a
// hobby-scale app is how keys leak.
//
// Why a single JSON file instead of one entry per service:
//   - It is easier to atomically rewrite a small JSON than juggle a
//     directory of files.
//   - Read-modify-write is fine because writes are user-initiated
//     (saving a key in Settings); there is no concurrent producer.
//
// Storage shape on disk:
// {
//   "v": 1,
//   "secrets": {
//     "<key-id>": "<base64 of safeStorage.encryptString output>"
//   }
// }
//
// `<key-id>` is opaque to this module — callers pick stable ids like
// "stt.assemblyai" or "openrouter".

type SecretFile = {
  v: 1
  secrets: Record<string, string>
}

const FILE_VERSION = 1

function secretsPath(): string {
  // app.getPath('userData') is the standard Electron config dir per
  // platform. We deliberately do NOT colocate this with the rest of
  // our settings JSON because mixing encrypted blobs with diffable
  // settings makes both harder to debug.
  return join(app.getPath('userData'), 'secrets.json')
}

async function readFileIfExists(): Promise<SecretFile> {
  try {
    const raw = await readFile(secretsPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<SecretFile>
    if (parsed?.v === FILE_VERSION && parsed.secrets && typeof parsed.secrets === 'object') {
      return { v: FILE_VERSION, secrets: parsed.secrets }
    }
  } catch (err) {
    // ENOENT on first launch is the common case. Anything else
    // (corrupt JSON, permission error) we log to console — a fresh
    // empty store is the safest fallback because the user can
    // re-enter their keys from the Settings UI.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // eslint-disable-next-line no-console
      console.warn('[secrets] failed to read store:', err)
    }
  }
  return { v: FILE_VERSION, secrets: {} }
}

async function writeFileAtomic(file: SecretFile): Promise<void> {
  const target = secretsPath()
  await mkdir(dirname(target), { recursive: true })
  // Plain writeFile is acceptable here — secrets.json is tiny and a
  // half-written file would just look like "no key configured" on
  // next launch, prompting the user to re-enter. The added
  // complexity of write-rename atomic swaps is not worth it for this
  // failure mode.
  await writeFile(target, JSON.stringify(file, null, 2), 'utf8')
}

export async function getSecret(id: string): Promise<string | null> {
  if (!safeStorage.isEncryptionAvailable()) {
    // safeStorage falls back to a no-op encryption on platforms where
    // OS-backed encryption is unavailable. We refuse to use the
    // store at all in that case rather than pretending — if the user
    // is on a misconfigured Linux box with no kwallet/secret-service,
    // they should know up front.
    return null
  }
  const file = await readFileIfExists()
  const encoded = file.secrets[id]
  if (!encoded) return null
  try {
    const buf = Buffer.from(encoded, 'base64')
    return safeStorage.decryptString(buf)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[secrets] decrypt failed for ${id}:`, err)
    return null
  }
}

export async function setSecret(id: string, value: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-backed encryption is not available; refusing to store key.')
  }
  const file = await readFileIfExists()
  const encrypted = safeStorage.encryptString(value)
  file.secrets[id] = encrypted.toString('base64')
  await writeFileAtomic(file)
}

export async function clearSecret(id: string): Promise<void> {
  const file = await readFileIfExists()
  if (!(id in file.secrets)) return
  delete file.secrets[id]
  await writeFileAtomic(file)
}

export async function listConfiguredSecretIds(): Promise<string[]> {
  // Renderer does not see decrypted values. It calls this to ask
  // "is a key for this provider configured?" so the Settings UI
  // can show the correct empty/filled state without ever pulling
  // the key into renderer memory.
  const file = await readFileIfExists()
  return Object.keys(file.secrets)
}
