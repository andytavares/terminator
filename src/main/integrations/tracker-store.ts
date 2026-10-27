import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { app, safeStorage } from 'electron'
import type {
  MineSelector,
  TrackerAccount,
  TrackerConnection,
  TrackerErrorKind,
  TrackerId,
} from '../../shared/types/index.js'
import type { StoredCredential } from './providers/provider.js'
import { writeJsonAtomic } from '@terminator/extension-sdk/node'

// Where tracker credentials live now that they are the application's rather
// than one extension's.
//
// Secrets are encrypted with safeStorage — Electron's own keychain wrapper —
// and everything else in the file is left readable, because a file you cannot
// inspect is a file you cannot debug. Written atomically so a crash mid-write
// cannot leave a half-file that reads as "not connected" on next launch.

const TRACKERS: readonly TrackerId[] = ['linear']
const FILE_NAME = 'integrations.json'

interface StoredTracker {
  /** base64 of the safeStorage ciphertext. Absent means not connected. */
  secret?: string
  mine?: MineSelector
  account?: TrackerAccount
  lastError?: TrackerErrorKind
}

type StoreFile = Partial<Record<TrackerId, StoredTracker>>

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function encrypt(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    // Refusing is the only safe answer: the alternative is writing the
    // operator's API token to disk in the clear because their keychain was
    // locked.
    throw new Error('OS credential storage is unavailable — cannot store a credential safely')
  }
  return safeStorage.encryptString(value).toString('base64')
}

function decrypt(encoded: string): string | null {
  try {
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
  } catch {
    // A credential encrypted under a keychain we can no longer open is gone,
    // not a crash. The operator reconnects.
    return null
  }
}

async function readStoreFile(file: string): Promise<StoreFile> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    // An older release stored a second tracker here; only known trackers are kept.
    const { linear } = parsed as StoreFile
    return linear === undefined ? {} : { linear }
  } catch {
    // Missing or unreadable: no credentials. Never a startup failure.
    return {}
  }
}

async function write(file: string, data: StoreFile): Promise<void> {
  await writeJsonAtomic(file, data)
}

// Each change rewrites the whole file, so two at once (two trackers answering one listMine) would
// overwrite each other, and a read could miss one under way. Every access waits for those asked for
// before it, and takes the file's path when it is asked for.
let queue: Promise<unknown> = Promise.resolve()

function serialized<T>(op: (file: string) => Promise<T>): Promise<T> {
  const file = filePath()
  const run = queue.then(() => op(file))
  queue = run.catch(() => undefined)
  return run
}

function editStoreFile(edit: (data: StoreFile) => void): Promise<void> {
  return serialized(async (file) => {
    const data = await readStoreFile(file)
    edit(data)
    await write(file, data)
  })
}

function update(tracker: TrackerId, patch: Partial<StoredTracker>): Promise<void> {
  return editStoreFile((data) => {
    data[tracker] = { ...data[tracker], ...patch }
  })
}

function defaultMine(): MineSelector {
  return { kind: 'assignee', email: null }
}

export async function setCredential(cred: StoredCredential): Promise<void> {
  // Encrypt before touching the file: an unavailable keychain must leave no
  // trace behind, not a half-written entry.
  await update(cred.tracker, { secret: encrypt(cred.apiKey) })
}

export async function getCredential(tracker: TrackerId): Promise<StoredCredential | null> {
  const entry = (await serialized(readStoreFile))[tracker]
  if (entry?.secret === undefined) return null
  const secret = decrypt(entry.secret)
  if (secret === null) return null
  return { tracker, apiKey: secret }
}

export function clearCredential(tracker: TrackerId): Promise<void> {
  return editStoreFile((data) => {
    // The mine selector survives a disconnect: it is the operator's
    // configuration, not the credential's.
    const kept = data[tracker]?.mine
    data[tracker] = kept === undefined ? {} : { mine: kept }
  })
}

export async function setAccount(tracker: TrackerId, account: TrackerAccount): Promise<void> {
  await update(tracker, { account, lastError: undefined })
}

export async function setLastError(
  tracker: TrackerId,
  kind: TrackerErrorKind | null
): Promise<void> {
  await update(tracker, { lastError: kind ?? undefined })
}

export async function setMine(tracker: TrackerId, mine: MineSelector): Promise<void> {
  await update(tracker, { mine })
}

export async function getMine(tracker: TrackerId): Promise<MineSelector> {
  return (await serialized(readStoreFile))[tracker]?.mine ?? defaultMine()
}

/**
 * What the renderer is allowed to know. Never the secret — only whether one
 * exists and which account it proved to belong to.
 */
export async function listConnections(): Promise<TrackerConnection[]> {
  const data = await serialized(readStoreFile)
  return TRACKERS.map((tracker) => {
    const entry = data[tracker] ?? {}
    return {
      tracker,
      connected: entry.secret !== undefined,
      account: entry.account ?? null,
      mine: entry.mine ?? defaultMine(),
      lastError: entry.lastError ?? null,
    }
  })
}
