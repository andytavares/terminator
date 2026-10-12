import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { makeTempDir } from '../../support/temp-dir'

let userData: string

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (buf: Buffer) => buf.toString('utf8').replace(/^enc:/, ''),
  },
}))

const providers = vi.hoisted(() => ({
  linear: { id: 'linear', get: vi.fn().mockResolvedValue(null) },
  jira: { id: 'jira', get: vi.fn().mockResolvedValue(null) },
}))

vi.mock('../../../src/main/integrations/providers/linear.provider', () => ({
  createLinearProvider: vi.fn(() => providers.linear),
}))
vi.mock('../../../src/main/integrations/providers/jira.provider', () => ({
  createJiraProvider: vi.fn(() => providers.jira),
}))

// The service records each call's outcome with a write nobody awaits
// (`void setLastError`). Each test waits for its writes, so none lands in a
// later test's userData or in a directory already removed.
const lastErrorWrites = vi.hoisted(() => [] as Promise<void>[])
vi.mock('../../../src/main/integrations/tracker-store', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../src/main/integrations/tracker-store')>()
  return {
    ...real,
    setLastError: (...args: Parameters<typeof real.setLastError>) => {
      const write = real.setLastError(...args)
      lastErrorWrites.push(write)
      return write
    },
  }
})
afterEach(() => Promise.all(lastErrorWrites.splice(0)))

const LINEAR = { tracker: 'linear', apiKey: 'k' } as const
const JIRA = {
  tracker: 'jira',
  site: 'acme.atlassian.net',
  email: 'a@acme.dev',
  apiToken: 't',
} as const

let trackers: typeof import('../../../src/main/integrations/tracker-store')

async function load() {
  return import('../../../src/main/integrations/index')
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  userData = makeTempDir('integrations-index-')
  trackers = await import('../../../src/main/integrations/tracker-store')
  await trackers.setCredential(LINEAR)
  await trackers.setCredential(JIRA)
})

describe('integrations composition root', () => {
  it('hands out one service, so a cached issue is shared across every surface', async () => {
    const mod = await load()
    expect(mod.getIssueService()).toBe(mod.getIssueService())
  })

  it('builds a fresh service after a reset — a new credential needs a new client', async () => {
    const mod = await load()
    const first = mod.getIssueService()
    mod.resetIssueService()
    expect(mod.getIssueService()).not.toBe(first)
  })

  it('wires both providers in', async () => {
    const mod = await load()
    const service = mod.getIssueService()
    await service.get('linear', 'TAV-1')
    await service.get('jira', 'TAV-1')
    expect(providers.linear.get).toHaveBeenCalledWith(LINEAR, 'TAV-1')
    expect(providers.jira.get).toHaveBeenCalledWith(JIRA, 'TAV-1')
  })

  it('records a tracker error against the connection so settings can show it', async () => {
    const mod = await load()
    // Built from the freshly-loaded module graph: vi.resetModules() gives the
    // service its own copy of the class, and `instanceof` across the two
    // copies is false.
    const { TrackerError } = await import('../../../src/main/integrations/tracker-error')
    providers.linear.get.mockRejectedValueOnce(new TrackerError('auth-failed', 'revoked'))
    await mod
      .getIssueService()
      .get('linear', 'TAV-1')
      .catch(() => null)
    // The error is written to the store in the background; under a loaded
    // pre-commit run that took longer than vi.waitFor's 1 s default.
    await vi.waitFor(
      async () =>
        expect(await trackers.listConnections()).toContainEqual(
          expect.objectContaining({ tracker: 'linear', lastError: 'auth-failed' })
        ),
      { timeout: 5000 }
    )
  })

  it('reads credentials from the store rather than holding its own', async () => {
    const mod = await load()
    const service = mod.getIssueService()
    await trackers.setCredential({ tracker: 'linear', apiKey: 'rotated' })
    await service.get('linear', 'TAV-1')
    expect(providers.linear.get).toHaveBeenCalledWith(
      { tracker: 'linear', apiKey: 'rotated' },
      'TAV-1'
    )
  })
})
