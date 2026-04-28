import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// Local-only history of dictations.
//
// Why local-only: this app is privacy-first. We never POST raw or
// polished transcripts anywhere except the chosen STT provider and
// OpenRouter. The Home list is a convenience for "what did I just
// dictate", not a syncable note system. If the user wants notes,
// they paste into a notes app.
//
// We store text only — never audio bytes. Audio buffers are 100x
// larger than the resulting text and the privacy tradeoff is bad
// (raw mic recordings sitting on disk forever).
//
// Hard cap on size: we keep the most recent N entries. Older ones
// fall off the end. There is no compaction or paging — the file is
// expected to stay tiny because text per dictation is short.

export type DictationRecord = {
  id: string
  ts: number
  raw: string
  polished: string | null
  finalText?: string | null
  provider: string
  model: string | null
  durationMs: number
  audioDurationMs?: number | null
}

const FILE_VERSION = 1
const MAX_ENTRIES = 200

type RecentsFile = {
  v: 1
  entries: DictationRecord[]
}

function recentsPath(): string {
  return join(app.getPath('userData'), 'recents.json')
}

async function read(): Promise<RecentsFile> {
  try {
    const raw = await readFile(recentsPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<RecentsFile>
    if (parsed?.v === FILE_VERSION && Array.isArray(parsed.entries)) {
      return { v: FILE_VERSION, entries: parsed.entries }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // eslint-disable-next-line no-console
      console.warn('[recents] failed to read store:', err)
    }
  }
  return { v: FILE_VERSION, entries: [] }
}

async function write(file: RecentsFile): Promise<void> {
  const target = recentsPath()
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, JSON.stringify(file, null, 2), 'utf8')
}

export async function listRecents(): Promise<DictationRecord[]> {
  const file = await read()
  return file.entries
}

export async function appendRecent(record: DictationRecord): Promise<DictationRecord[]> {
  const file = await read()
  // Prepend so the most recent is at the top. We could keep them
  // chronologically and reverse in the UI, but the UI is the only
  // consumer and it always wants newest-first — easier to just
  // store in display order.
  file.entries.unshift(record)
  if (file.entries.length > MAX_ENTRIES) {
    file.entries.length = MAX_ENTRIES
  }
  await write(file)
  return file.entries
}

export async function deleteRecent(id: string): Promise<DictationRecord[]> {
  const file = await read()
  const idx = file.entries.findIndex(entry => entry.id === id)
  if (idx === -1) return file.entries
  file.entries.splice(idx, 1)
  await write(file)
  return file.entries
}

export async function clearRecents(): Promise<void> {
  await write({ v: FILE_VERSION, entries: [] })
}
