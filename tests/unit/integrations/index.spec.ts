import { describe, it, expect, beforeEach, vi } from 'vitest'

const store = vi.hoisted(() => ({
  getCredential: vi.fn().mockResolvedValue({ tracker: 'linear', apiKey: 'k' }),
  getMine: vi.fn().mockResolvedValue({ kind: 'assignee', email: null }),
  setLastError: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../src/main/integrations/tracker-store', () => store)

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

async function load() {
  vi.resetModules()
  return import('../../../src/main/integrations/index')
}

beforeEach(() => vi.clearAllMocks())

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
    expect(providers.linear.get).toHaveBeenCalled()
    expect(providers.jira.get).toHaveBeenCalled()
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
    expect(store.setLastError).toHaveBeenCalledWith('linear', 'auth-failed')
  })

  it('reads credentials from the store rather than holding its own', async () => {
    const mod = await load()
    await mod.getIssueService().get('linear', 'TAV-1')
    expect(store.getCredential).toHaveBeenCalledWith('linear')
  })
})
