import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the api.shell.exec call
const mockExec = vi.fn()
const mockApi = {
  shell: { exec: mockExec },
}

import { GhService } from '../../src/github/gh-service'

let service: GhService

beforeEach(() => {
  vi.clearAllMocks()
  service = new GhService(mockApi as never)
})

describe('GhService.checkAuth()', () => {
  it('resolves true when gh auth status exits 0', async () => {
    mockExec.mockResolvedValue({ exitCode: 0, stdout: 'Logged in', stderr: '', timedOut: false })
    const result = await service.checkAuth('/tmp/repo')
    expect(result).toBe(true)
  })

  it('resolves false when gh exits non-zero', async () => {
    mockExec.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'not logged in',
      timedOut: false,
    })
    const result = await service.checkAuth('/tmp/repo')
    expect(result).toBe(false)
  })

  it('resolves false when gh is not found', async () => {
    mockExec.mockRejectedValue(new Error('ENOENT'))
    const result = await service.checkAuth('/tmp/repo')
    expect(result).toBe(false)
  })
})

describe('GhService.getPrForBranch()', () => {
  it('returns PullRequest when PR exists', async () => {
    const prJson = JSON.stringify({
      number: 42,
      title: 'feat: new feature',
      body: 'Description',
      url: 'https://github.com/org/repo/pull/42',
      state: 'OPEN',
      isDraft: false,
      baseRefName: 'main',
      headRefName: 'feat/new-feature',
    })
    mockExec.mockResolvedValue({ exitCode: 0, stdout: prJson, stderr: '', timedOut: false })

    const pr = await service.getPrForBranch('/tmp/repo', 'feat/new-feature')
    expect(pr).not.toBeNull()
    expect(pr?.number).toBe(42)
    expect(pr?.isDraft).toBe(false)
  })

  it('returns null when no PR found', async () => {
    mockExec.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'no pull requests found',
      timedOut: false,
    })
    const pr = await service.getPrForBranch('/tmp/repo', 'feat/new-feature')
    expect(pr).toBeNull()
  })

  it('throws on unexpected gh error', async () => {
    mockExec.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'network error',
      timedOut: false,
    })
    await expect(service.getPrForBranch('/tmp/repo', 'feat/new-feature')).rejects.toThrow()
  })
})

describe('GhService.createPr()', () => {
  it('returns created PullRequest with url', async () => {
    const prJson = JSON.stringify({
      number: 43,
      title: 'feat: add thing',
      body: 'Body',
      url: 'https://github.com/org/repo/pull/43',
      state: 'OPEN',
      isDraft: false,
      baseRefName: 'main',
      headRefName: 'feat/add-thing',
    })
    mockExec.mockResolvedValue({ exitCode: 0, stdout: prJson, stderr: '', timedOut: false })

    const pr = await service.createPr('/tmp/repo', {
      title: 'feat: add thing',
      body: 'Body',
      base: 'main',
      isDraft: false,
    })
    expect(pr.url).toBe('https://github.com/org/repo/pull/43')
    expect(pr.isDraft).toBe(false)
  })

  it('creates draft PR when isDraft=true', async () => {
    const prJson = JSON.stringify({
      number: 44,
      title: 'WIP: draft',
      body: '',
      url: 'https://github.com/org/repo/pull/44',
      state: 'OPEN',
      isDraft: true,
      baseRefName: 'main',
      headRefName: 'wip/draft',
    })
    mockExec.mockResolvedValue({ exitCode: 0, stdout: prJson, stderr: '', timedOut: false })

    const pr = await service.createPr('/tmp/repo', {
      title: 'WIP: draft',
      body: '',
      base: 'main',
      isDraft: true,
    })
    expect(pr.isDraft).toBe(true)

    // Verify --draft flag was passed
    const execCall = mockExec.mock.calls[0][0]
    expect(execCall.args).toContain('--draft')
  })
})
