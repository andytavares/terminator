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

// Where tracker credentials live now that they are the application's rather
// than one extension's.
//
// Secrets are encrypted with safeStorage — Electron's own keychain wrapper —
// and everything else in the file is left readable, because a file you cannot
// inspect is a file you cannot debug. Written atomically so a crash mid-write
// cannot leave a half-file that reads as "not connected" on next launch.

const TRACKERS: readonly TrackerId[] = ['linear', 'jira']
const FILE_NAME = 'integrations.json'
const LEGACY_FILE_NAME = 'speckit-pilot-creds.json'

const DEFAULT_JIRA_JQL =
  'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC'

interface StoredTracker {
  /** base64 of the safeStorage ciphertext. Absent means not connected. */
  secret?: string
  /** Jira only. Not a secret — it is in every issue URL. */
  site?: string
  /** Jira only. Not a secret. */
  email?: string
  mine?: MineSelector
  account?: TrackerAccount
  lastError?: TrackerErrorKind
}

type StoreFile = Partial<Record<TrackerId, StoredTracker>>

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function legacyPath(): string {
  return path.join(app.getPath('userData'), LEGACY_FILE_NAME)
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

async function read(): Promise<StoreFile> {
  try {
    const raw = await fs.readFile(filePath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as StoreFile) : {}
  } catch {
    // Missing or unreadable: no credentials. Never a startup failure.
    return {}
  }
}

async function write(data: StoreFile): Promise<void> {
  const target = filePath()
  const tmp = `${target}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(tmp, target)
}

async function update(tracker: TrackerId, patch: Partial<StoredTracker>): Promise<void> {
  const data = await read()
  data[tracker] = { ...data[tracker], ...patch }
  await write(data)
}

function defaultMine(tracker: TrackerId): MineSelector {
  return tracker === 'linear'
    ? { kind: 'assignee', email: null }
    : { kind: 'query', jql: DEFAULT_JIRA_JQL }
}

export async function setCredential(cred: StoredCredential): Promise<void> {
  // Encrypt before touching the file: an unavailable keychain must leave no
  // trace behind, not a half-written entry.
  const secret = encrypt(cred.tracker === 'linear' ? cred.apiKey : cred.apiToken)
  await update(cred.tracker, {
    secret,
    ...(cred.tracker === 'jira' ? { site: cred.site, email: cred.email } : {}),
  })
}

export async function getCredential(tracker: TrackerId): Promise<StoredCredential | null> {
  const entry = (await read())[tracker]
  if (entry?.secret === undefined) return null
  const secret = decrypt(entry.secret)
  if (secret === null) return null

  if (tracker === 'linear') return { tracker: 'linear', apiKey: secret }
  if (entry.site === undefined || entry.email === undefined) return null
  return { tracker: 'jira', site: entry.site, email: entry.email, apiToken: secret }
}

export async function clearCredential(tracker: TrackerId): Promise<void> {
  const data = await read()
  // The mine selector survives a disconnect: it is the operator's
  // configuration, not the credential's, and retyping a JQL query because a
  // token expired is a small insult that adds up.
  const kept = data[tracker]?.mine
  data[tracker] = kept === undefined ? {} : { mine: kept }
  await write(data)
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
  return (await read())[tracker]?.mine ?? defaultMine(tracker)
}

/**
 * What the renderer is allowed to know. Never the secret — only whether one
 * exists and which account it proved to belong to.
 */
export async function listConnections(): Promise<TrackerConnection[]> {
  const data = await read()
  return TRACKERS.map((tracker) => {
    const entry = data[tracker] ?? {}
    return {
      tracker,
      connected: entry.secret !== undefined,
      account: entry.account ?? null,
      site: tracker === 'jira' ? (entry.site ?? null) : null,
      mine: entry.mine ?? defaultMine(tracker),
      lastError: entry.lastError ?? null,
    }
  })
}

interface LegacyFile {
  linearKey?: string
  linearEmail?: string
  jiraCreds?: { domain?: string; email?: string; apiToken?: string; jql?: string }
}

/**
 * Adopt the credentials the SpecKit Pilot extension stored, once (FR-004).
 *
 * The operator already gave these; asking again because the code moved would
 * be the migration failing at the only thing it exists to do. The legacy file
 * is renamed rather than deleted so a bad migration is recoverable by hand,
 * and an existing credential here always wins — this never overwrites
 * something entered in the new settings.
 */
export async function migrateLegacyCredentials(): Promise<void> {
  let legacy: LegacyFile
  try {
    legacy = JSON.parse(await fs.readFile(legacyPath(), 'utf8')) as LegacyFile
  } catch {
    // Absent, or corrupt beyond use. Neither is worth failing startup over.
    return
  }

  try {
    const data = await read()

    if (legacy.linearKey !== undefined && data.linear?.secret === undefined) {
      const key = decrypt(legacy.linearKey)
      if (key !== null) {
        data.linear = {
          ...data.linear,
          secret: encrypt(key),
          mine: { kind: 'assignee', email: legacy.linearEmail ?? null },
        }
      }
    }

    const jira = legacy.jiraCreds
    if (jira?.apiToken !== undefined && data.jira?.secret === undefined) {
      const token = decrypt(jira.apiToken)
      if (token !== null && jira.domain !== undefined && jira.email !== undefined) {
        data.jira = {
          ...data.jira,
          secret: encrypt(token),
          site: jira.domain,
          email: jira.email,
          mine: { kind: 'query', jql: jira.jql ?? DEFAULT_JIRA_JQL },
        }
      }
    }

    await write(data)
    await fs.rename(legacyPath(), `${legacyPath()}.bak`)
  } catch {
    // A migration that cannot finish leaves the legacy file in place so it can
    // be retried, and the operator can still connect by hand.
  }
}
