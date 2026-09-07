import { describe, it, expect, vi } from 'vitest'
import { createLinearProvider } from '../../../../src/main/integrations/providers/linear.provider'
import { makeIssue, makeTeam } from '../../../fixtures/integrations/linear/index'
import type { StoredCredential } from '../../../../src/main/integrations/providers/provider'

// Intent resolution, and the one rule it must never break: resolve by the
// state's `type`, never by its name.
//
// Linear's own agent guidance queries states filtered by `type` for exactly
// this reason — a team renames "In Progress" to "Building" on a Tuesday and a
// name-matching integration silently stops moving anything.

const CRED: StoredCredential = { tracker: 'linear', apiKey: 'lin_api_key' }

function providerWith(client: Record<string, unknown>) {
  return createLinearProvider(() => client as never)
}

/** A client whose `issue()` returns one issue and whose update we can read. */
function clientFor(over: Parameters<typeof makeIssue>[0] = {}) {
  const updateIssue = vi.fn().mockResolvedValue({ success: true })
  const issue = vi.fn().mockResolvedValue(makeIssue(over))
  return { client: { issue, updateIssue }, updateIssue, issue }
}

describe('linear provider — states', () => {
  it("reads the issue's own team workflow", async () => {
    const { client } = clientFor()
    const options = await providerWith(client).states?.(CRED, 'TAV-42')
    expect(options?.map((o) => o.name)).toEqual([
      'Backlog',
      'Todo',
      'In Progress',
      'In Review',
      'Done',
      'Cancelled',
    ])
  })

  it('maps started to the first started state and done to the completed one, by type', async () => {
    const { client } = clientFor()
    const options = (await providerWith(client).states?.(CRED, 'TAV-42')) ?? []
    const byIntent = Object.fromEntries(
      options.filter((o) => o.intent !== null).map((o) => [o.intent, o.id])
    )
    expect(byIntent.started).toBe('st-progress')
    expect(byIntent.done).toBe('st-done')
  })

  it('offers the later started state as in review, since Linear has no review type', async () => {
    const { client } = clientFor()
    const options = (await providerWith(client).states?.(CRED, 'TAV-42')) ?? []
    expect(options.find((o) => o.intent === 'in_review')?.id).toBe('st-review')
  })

  it('resolves by type and not by name, however the states are named', async () => {
    const renamed = makeTeam({
      states: () =>
        Promise.resolve({
          nodes: [
            { id: 'a', name: 'Icebox', type: 'backlog', position: 0 },
            { id: 'b', name: 'Cooking', type: 'started', position: 1 },
            { id: 'c', name: 'Shipped', type: 'completed', position: 2 },
          ],
        }),
    })
    const { client } = clientFor({ team: Promise.resolve(renamed) })
    const options = (await providerWith(client).states?.(CRED, 'TAV-42')) ?? []
    expect(options.find((o) => o.intent === 'started')?.name).toBe('Cooking')
    expect(options.find((o) => o.intent === 'done')?.name).toBe('Shipped')
  })

  it('offers no review option when the workflow has only one started state', async () => {
    const single = makeTeam({
      states: () =>
        Promise.resolve({
          nodes: [
            { id: 'b', name: 'Doing', type: 'started', position: 1 },
            { id: 'c', name: 'Done', type: 'completed', position: 2 },
          ],
        }),
    })
    const { client } = clientFor({ team: Promise.resolve(single) })
    const options = (await providerWith(client).states?.(CRED, 'TAV-42')) ?? []
    expect(options.some((o) => o.intent === 'in_review')).toBe(false)
    expect(options.find((o) => o.intent === 'started')?.id).toBe('b')
  })

  it('leaves backlog, unstarted and cancelled states carrying no intent', async () => {
    const { client } = clientFor()
    const options = (await providerWith(client).states?.(CRED, 'TAV-42')) ?? []
    for (const name of ['Backlog', 'Todo', 'Cancelled']) {
      expect(options.find((o) => o.name === name)?.intent).toBeNull()
    }
  })

  it('reports every option as available — Linear accepts any state from any', async () => {
    const { client } = clientFor()
    const options = (await providerWith(client).states?.(CRED, 'TAV-42')) ?? []
    expect(options.every((o) => o.available)).toBe(true)
  })

  it('raises not-found rather than returning nothing for an issue that is gone', async () => {
    const client = { issue: vi.fn().mockResolvedValue(null), updateIssue: vi.fn() }
    await expect(providerWith(client).states?.(CRED, 'TAV-99')).rejects.toMatchObject({
      kind: 'not-found',
    })
  })

  it('returns nothing for an issue with no team rather than throwing', async () => {
    const { client } = clientFor({ team: Promise.resolve(null) })
    await expect(providerWith(client).states?.(CRED, 'TAV-42')).resolves.toEqual([])
  })
})

describe('linear provider — transition', () => {
  it('applies the resolved state id through issueUpdate', async () => {
    const { client, updateIssue } = clientFor()
    await providerWith(client).transition?.(CRED, 'TAV-42', 'started')
    expect(updateIssue).toHaveBeenCalledWith('11111111-2222-3333-4444-555555555555', {
      stateId: 'st-progress',
    })
  })

  it('addresses the issue by its UUID, never by the human key', async () => {
    const { client, updateIssue } = clientFor()
    await providerWith(client).transition?.(CRED, 'TAV-42', 'done')
    expect(updateIssue.mock.calls[0][0]).not.toBe('TAV-42')
  })

  it("honours the operator's own mapping when one is given", async () => {
    const { client, updateIssue } = clientFor()
    // The operator decided "In Progress" is what in review means for them.
    await providerWith(client).transition?.(CRED, 'TAV-42', 'in_review', 'st-progress')
    expect(updateIssue).toHaveBeenCalledWith(expect.any(String), { stateId: 'st-progress' })
  })

  it('rejects an override naming a state this workflow does not have', async () => {
    const { client, updateIssue } = clientFor()
    await expect(
      providerWith(client).transition?.(CRED, 'TAV-42', 'in_review', 'st-nonsense')
    ).rejects.toThrow(/st-nonsense/)
    expect(updateIssue).not.toHaveBeenCalled()
  })

  it('rejects when no available state satisfies the intent, rather than moving somewhere else', async () => {
    const noReview = makeTeam({
      states: () =>
        Promise.resolve({
          nodes: [
            { id: 'b', name: 'Doing', type: 'started', position: 1 },
            { id: 'c', name: 'Done', type: 'completed', position: 2 },
          ],
        }),
    })
    const { client, updateIssue } = clientFor({ team: Promise.resolve(noReview) })
    await expect(
      providerWith(client).transition?.(CRED, 'TAV-42', 'in_review')
    ).rejects.toMatchObject({ kind: 'not-found' })
    expect(updateIssue).not.toHaveBeenCalled()
  })

  it('raises when Linear refuses the update', async () => {
    const { client } = clientFor()
    client.updateIssue = vi.fn().mockResolvedValue({ success: false })
    await expect(providerWith(client).transition?.(CRED, 'TAV-42', 'done')).rejects.toMatchObject({
      kind: 'failed',
    })
  })

  it('translates an SDK rate limit rather than letting it escape raw', async () => {
    const { client } = clientFor()
    client.updateIssue = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('Rate limited'), { type: 'Ratelimited', retryAfter: 30 })
      )
    await expect(providerWith(client).transition?.(CRED, 'TAV-42', 'done')).rejects.toMatchObject({
      kind: 'rate-limited',
      retryAfterMs: 30000,
    })
  })
})
