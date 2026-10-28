import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { makeTempDir } from '../../support/temp-dir'

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
  userData = makeTempDir('tracker-store-')
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

  it('returns null for a tracker that was never connected', async () => {
    const store = await load()
    await expect(store.getCredential('linear')).resolves.toBeNull()
  })
})

describe('tracker-store — reload', () => {
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
    await store.setAccount('linear', { name: 'Andrew', email: 'a@b.c' })
    const raw = fs.readFileSync(credsPath(), 'utf8')
    expect(raw).not.toContain('super-secret-key')
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
    await store.setCredential({ tracker: 'linear', apiKey: 'lin-secret' })
    await store.setAccount('linear', { name: 'Andrew', email: 'a@b.c' })

    const [linear] = (await store.listConnections()).filter((c) => c.tracker === 'linear')
    expect(linear).toMatchObject({
      tracker: 'linear',
      connected: true,
      account: { name: 'Andrew', email: 'a@b.c' },
    })
    expect(JSON.stringify(linear)).not.toContain('lin-secret')
  })

  it('reports every tracker, connected or not', async () => {
    const store = await load()
    const connections = await store.listConnections()
    expect(connections.map((c) => c.tracker)).toEqual(['linear'])
    expect(connections.every((c) => c.connected === false)).toBe(true)
  })
})

describe('tracker-store — mine selector', () => {
  it('defaults the mine selector to the signed-in assignee', async () => {
    const store = await load()
    const linear = (await store.listConnections()).find((c) => c.tracker === 'linear')
    expect(linear?.mine).toEqual({ kind: 'assignee', email: null })
  })

  it('stores a mine selector and reads it back', async () => {
    const store = await load()
    await store.setMine('linear', { kind: 'assignee', email: 'me@x.c' })
    const linear = (await store.listConnections()).find((c) => c.tracker === 'linear')
    expect(linear?.mine).toEqual({ kind: 'assignee', email: 'me@x.c' })
  })
})

describe('tracker-store — concurrent writes', () => {
  it('answers a read after the writes already asked for', async () => {
    const store = await load()
    const written = store.setLastError('linear', 'auth-failed')
    const linear = (await store.listConnections()).find((c) => c.tracker === 'linear')
    expect(linear?.lastError).toBe('auth-failed')
    await written
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

describe('tracker-store — a file written when Jira was supported', () => {
  const storedByAnOlderRelease = {
    linear: { secret: Buffer.from('enc:lin_key', 'utf8').toString('base64') },
    jira: { secret: 'c2VjcmV0', site: 'tav.atlassian.net', email: 'a@b.c' },
  }

  it('still reads the Linear credential and lists only Linear', async () => {
    fs.writeFileSync(credsPath(), JSON.stringify(storedByAnOlderRelease), 'utf8')
    const store = await load()

    await expect(store.getCredential('linear')).resolves.toEqual({
      tracker: 'linear',
      apiKey: 'lin_key',
    })
    expect((await store.listConnections()).map((c) => c.tracker)).toEqual(['linear'])
  })

  it('drops the Jira entry the next time the file is written', async () => {
    fs.writeFileSync(credsPath(), JSON.stringify(storedByAnOlderRelease), 'utf8')
    const store = await load()
    await store.setAccount('linear', { name: 'Andrew', email: 'a@b.c' })

    expect(Object.keys(JSON.parse(fs.readFileSync(credsPath(), 'utf8')))).toEqual(['linear'])
  })
})
