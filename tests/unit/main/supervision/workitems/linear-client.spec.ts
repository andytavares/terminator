import { describe, it, expect, vi } from 'vitest'
import {
  fetchAssignedIssues,
  type FetchLike,
} from '../../../../../src/main/supervision/workitems/linear-client.js'

// Read-only and one-directional. Every failure has to be stated: an empty list
// where the key was rejected reads as "you have no issues".

const issue = (over: Record<string, unknown> = {}) => ({
  identifier: 'FLU-220',
  title: 'Unify session identity',
  url: 'https://linear.app/team/issue/FLU-220',
  createdAt: '2026-07-27T09:04:11Z',
  state: { name: 'In Progress' },
  ...over,
})

const replying = (body: unknown, status = 200): FetchLike =>
  vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body })

describe('pulling assigned issues', () => {
  it('returns them', async () => {
    const result = await fetchAssignedIssues(
      'lin_api_x',
      replying({ data: { viewer: { assignedIssues: { nodes: [issue()] } } } })
    )
    expect(result).toEqual({
      ok: true,
      issues: [
        {
          identifier: 'FLU-220',
          title: 'Unify session identity',
          url: 'https://linear.app/team/issue/FLU-220',
          createdAt: '2026-07-27T09:04:11Z',
          state: 'In Progress',
        },
      ],
    })
  })

  it('sends the key as the header value, which is what a personal key is', async () => {
    const fetchImpl = replying({ data: { viewer: { assignedIssues: { nodes: [] } } } })
    await fetchAssignedIssues('lin_api_x', fetchImpl)
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(init.headers.Authorization).toBe('lin_api_x')
  })

  it('asks only for issues that are not finished', async () => {
    const fetchImpl = replying({ data: { viewer: { assignedIssues: { nodes: [] } } } })
    await fetchAssignedIssues('lin_api_x', fetchImpl)
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]
    // A done issue is not work to pick up.
    expect(init.body).toContain('completed')
    expect(init.body).toContain('canceled')
  })

  it('refuses without a key rather than calling out', async () => {
    const fetchImpl = replying({})
    const result = await fetchAssignedIssues('   ', fetchImpl)
    expect(result).toEqual({ ok: false, reason: 'no Linear API key is configured' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('says the key was rejected rather than returning nothing', async () => {
    const result = await fetchAssignedIssues('bad', replying({}, 401))
    expect(result).toEqual({ ok: false, reason: 'Linear rejected the API key' })
  })

  it('reports any other status', async () => {
    const result = await fetchAssignedIssues('lin_api_x', replying({}, 503))
    expect(result).toMatchObject({ ok: false, reason: 'Linear replied 503' })
  })

  it('reports a GraphQL error, which arrives with a 200', async () => {
    const result = await fetchAssignedIssues(
      'lin_api_x',
      replying({ errors: [{ message: 'Access denied' }] })
    )
    expect(result).toMatchObject({ ok: false, reason: /Access denied/ })
  })

  it('reports being offline', async () => {
    const result = await fetchAssignedIssues(
      'lin_api_x',
      vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'))
    )
    expect(result).toMatchObject({ ok: false, reason: /ENOTFOUND/ })
  })

  it('reports a body that is not the shape it expects', async () => {
    const result = await fetchAssignedIssues('lin_api_x', replying({ data: {} }))
    expect(result).toEqual({ ok: false, reason: 'Linear returned no issue list' })
  })

  it('skips a node missing the fields that identify it', async () => {
    const result = await fetchAssignedIssues(
      'lin_api_x',
      replying({
        data: { viewer: { assignedIssues: { nodes: [{ title: 'no identifier' }, issue()] } } },
      })
    )
    expect(result).toMatchObject({ ok: true, issues: [{ identifier: 'FLU-220' }] })
  })

  it('tolerates an issue with no state', async () => {
    const result = await fetchAssignedIssues(
      'lin_api_x',
      replying({ data: { viewer: { assignedIssues: { nodes: [issue({ state: undefined })] } } } })
    )
    expect(result).toMatchObject({ ok: true, issues: [{ state: 'unknown' }] })
  })
})
