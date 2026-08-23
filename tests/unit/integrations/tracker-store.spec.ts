import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

let userData: string

// A flag rather than a second vi.doMock: re-mocking 'electron' mid-file and
// unmocking it again leaks into every later test in the file, which silently
// turns migration failures into "no credentials".
const keychain = vi.hoisted(() => ({ available: true }))

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => keychain.available,
    // Reversible and obviously not real, so a test that reads the file can
    // assert the plaintext is absent from it.
    encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (buf: Buffer) => buf.toString('utf8').replace(/^enc:/, ''),
  },
}))

async function load() {
  vi.resetModules()
  return import('../../../src/main/integrations/tracker-store')
}

function credsPath(): string {
  return path.join(userData, 'integrations.json')
}

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-store-'))
  keychain.available = true
})

describe('tracker-store — round trip', () => {
  it('stores and returns a Linear credential', async () => {
    const store = await load()
    await store.setCredential({ tracker: 'linear', apiKey: 'lin_key' })
    await expect(store.getCredential('linear')).resolves.toEqual({
      tracker: 'linear',
      apiKey: 'lin_key',
    })
  })

  it('stores and returns a Jira credential', async () => {
    const store = await load()
    await store.setCredential({
      tracker: 'jira',
      site: 'tav.atlassian.net',
      email: 'a@b.c',
      apiToken: 'tok',
    })
    await expect(store.getCredential('jira')).resolves.toMatchObject({ site: 'tav.atlassian.net' })
  })

  it('returns null for a tracker that was never connected', async () => {
    const store = await load()
    await expect(store.getCredential('linear')).resolves.toBeNull()
  })

  it('survives a reload — the file is the source of truth', async () => {
    const first = await load()
    await first.setCredential({ tracker: 'linear', apiKey: 'lin_key' })
    const second = await load()
    await expect(second.getCredential('linear')).resolves.toEqual({
      tracker: 'linear',
      apiKey: 'lin_key',
    })
  })
})

describe('tracker-store — secrets at rest', () => {
  it('never writes a secret in plaintext', async () => {
    const store = await load()
    await store.setCredential({ tracker: 'linear', apiKey: 'super-secret-key' })
    await store.setCredential({
      tracker: 'jira',
      site: 's.atlassian.net',
      email: 'a@b.c',
      apiToken: 'super-secret-token',
    })
    const raw = fs.readFileSync(credsPath(), 'utf8')
    expect(raw).not.toContain('super-secret-key')
    expect(raw).not.toContain('super-secret-token')
    // Non-secret fields are readable — they are not secrets, and hiding them
    // would make the file impossible to inspect when something goes wrong.
    expect(raw).toContain('s.atlassian.net')
  })

  it('leaves no temp file behind — the write is atomic', async () => {
    const store = await load()
    await store.setCredential({ tracker: 'linear', apiKey: 'k' })
    expect(fs.readdirSync(userData).filter((f) => f.endsWith('.tmp'))).toHaveLength(0)
  })
})

describe('tracker-store — connection view', () => {
  it('reports a connection without ever exposing the secret', async () => {
    const store = await load()
    await store.setCredential({ tracker: 'linear', apiKey: 'k' })
    await store.setAccount('linear', { name: 'Andrew', email: 'a@b.c' })

    const [linear] = (await store.listConnections()).filter((c) => c.tracker === 'linear')
    expect(linear).toMatchObject({
      tracker: 'linear',
      connected: true,
      account: { name: 'Andrew', email: 'a@b.c' },
    })
    expect(JSON.stringify(linear)).not.toContain('"k"')
  })

  it('reports every tracker, connected or not', async () => {
    const store = await load()
    const connections = await store.listConnections()
    expect(connections.map((c) => c.tracker).sort()).toEqual(['jira', 'linear'])
    expect(connections.every((c) => c.connected === false)).toBe(true)
  })

  it('defaults the mine selector per tracker', async () => {
    const store = await load()
    const connections = await store.listConnections()
    const linear = connections.find((c) => c.tracker === 'linear')
    const jira = connections.find((c) => c.tracker === 'jira')
    expect(linear?.mine).toEqual({ kind: 'assignee', email: null })
    expect(jira?.mine).toMatchObject({ kind: 'query' })
  })

  it('stores a mine selector and reads it back', async () => {
    const store = await load()
    await store.setMine('linear', { kind: 'assignee', email: 'me@x.c' })
    const linear = (await store.listConnections()).find((c) => c.tracker === 'linear')
    expect(linear?.mine).toEqual({ kind: 'assignee', email: 'me@x.c' })
  })
})

describe('tracker-store — disconnect', () => {
  it('destroys the credential', async () => {
    const store = await load()
    await store.setCredential({ tracker: 'linear', apiKey: 'k' })
    await store.clearCredential('linear')

    await expect(store.getCredential('linear')).resolves.toBeNull()
    expect(fs.readFileSync(credsPath(), 'utf8')).not.toContain('enc:k')
  })

  it('leaves the other tracker untouched', async () => {
    const store = await load()
    await store.setCredential({ tracker: 'linear', apiKey: 'lk' })
    await store.setCredential({ tracker: 'jira', site: 's', email: 'e@x.c', apiToken: 'jt' })
    await store.clearCredential('linear')
    await expect(store.getCredential('jira')).resolves.toMatchObject({ apiToken: 'jt' })
  })
})

describe('tracker-store — resilience', () => {
  it('treats an unreadable file as no credentials rather than crashing startup', async () => {
    fs.writeFileSync(credsPath(), 'not json at all', 'utf8')
    const store = await load()
    await expect(store.getCredential('linear')).resolves.toBeNull()
  })

  it('surfaces an unavailable keychain rather than storing a plaintext secret', async () => {
    const store = await load()
    keychain.available = false
    await expect(store.setCredential({ tracker: 'linear', apiKey: 'k' })).rejects.toThrow()
    // Nothing written at all — not even an entry with the secret omitted.
    expect(fs.existsSync(credsPath())).toBe(false)
  })
})

describe('tracker-store — migration from the extension (FR-004)', () => {
  function writeLegacy(contents: Record<string, unknown>): void {
    fs.writeFileSync(
      path.join(userData, 'speckit-pilot-creds.json'),
      JSON.stringify(contents),
      'utf8'
    )
  }

  /** The extension encrypted with safeStorage and base64'd the result. */
  function legacyEncrypt(value: string): string {
    return Buffer.from(`enc:${value}`, 'utf8').toString('base64')
  }

  it('adopts a Linear key and its email', async () => {
    writeLegacy({ linearKey: legacyEncrypt('legacy-linear'), linearEmail: 'me@x.c' })
    const store = await load()
    await store.migrateLegacyCredentials()

    await expect(store.getCredential('linear')).resolves.toEqual({
      tracker: 'linear',
      apiKey: 'legacy-linear',
    })
    const linear = (await store.listConnections()).find((c) => c.tracker === 'linear')
    expect(linear?.mine).toEqual({ kind: 'assignee', email: 'me@x.c' })
  })

  it('adopts Jira credentials and its JQL', async () => {
    writeLegacy({
      jiraCreds: {
        domain: 'tav.atlassian.net',
        email: 'me@x.c',
        apiToken: legacyEncrypt('legacy-jira'),
        jql: 'assignee = currentUser()',
      },
    })
    const store = await load()
    await store.migrateLegacyCredentials()

    await expect(store.getCredential('jira')).resolves.toEqual({
      tracker: 'jira',
      site: 'tav.atlassian.net',
      email: 'me@x.c',
      apiToken: 'legacy-jira',
    })
    const jira = (await store.listConnections()).find((c) => c.tracker === 'jira')
    expect(jira?.mine).toEqual({ kind: 'query', jql: 'assignee = currentUser()' })
  })

  it('renames the legacy file so the migration runs once', async () => {
    writeLegacy({ linearKey: legacyEncrypt('legacy-linear') })
    const store = await load()
    await store.migrateLegacyCredentials()

    expect(fs.existsSync(path.join(userData, 'speckit-pilot-creds.json'))).toBe(false)
    expect(fs.existsSync(path.join(userData, 'speckit-pilot-creds.json.bak'))).toBe(true)
  })

  it('is idempotent and never overwrites a credential entered here', async () => {
    writeLegacy({ linearKey: legacyEncrypt('legacy-linear') })
    const store = await load()
    await store.setCredential({ tracker: 'linear', apiKey: 'entered-by-hand' })
    await store.migrateLegacyCredentials()
    await store.migrateLegacyCredentials()

    await expect(store.getCredential('linear')).resolves.toEqual({
      tracker: 'linear',
      apiKey: 'entered-by-hand',
    })
  })

  it('does nothing when there is no legacy file', async () => {
    const store = await load()
    await expect(store.migrateLegacyCredentials()).resolves.toBeUndefined()
    await expect(store.getCredential('linear')).resolves.toBeNull()
  })

  it('does not prevent startup when the legacy file is corrupt', async () => {
    fs.writeFileSync(path.join(userData, 'speckit-pilot-creds.json'), '{{{', 'utf8')
    const store = await load()
    await expect(store.migrateLegacyCredentials()).resolves.toBeUndefined()
  })
})
