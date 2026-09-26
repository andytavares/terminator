import { describe, it, expect, vi } from 'vitest'
import { createLinearProvider } from '../../../../src/main/integrations/providers/linear.provider'
import { makeIssue } from '../../../fixtures/integrations/linear/index'
import type { StoredCredential } from '../../../../src/main/integrations/providers/provider'

// Creating an issue (ADR-061). The created issue is read back in full, because
// its branch name is the reason Foundry asked for it.

const CRED: StoredCredential = { tracker: 'linear', apiKey: 'lin_api_key' }

function providerWith(client: Record<string, unknown>) {
  return createLinearProvider(() => client as never)
}

describe('linear provider — teams', () => {
  it("lists the viewer's own teams, not every team in the workspace", async () => {
    const teams = vi.fn().mockResolvedValue({
      nodes: [
        { id: 't1', key: 'TAV', name: 'Team' },
        { id: 't2', key: 'OPS', name: 'Ops' },
      ],
    })
    const provider = providerWith({ viewer: Promise.resolve({ name: 'A', email: 'a@b.c', teams }) })
    await expect(provider.teams?.(CRED)).resolves.toEqual([
      { id: 't1', key: 'TAV', name: 'Team' },
      { id: 't2', key: 'OPS', name: 'Ops' },
    ])
  })
})

describe('linear provider — create', () => {
  it('files the title and description in the chosen team and returns the whole issue', async () => {
    const createIssue = vi
      .fn()
      .mockResolvedValue({ success: true, issue: Promise.resolve(makeIssue()) })
    const issue = await providerWith({ createIssue }).create?.(CRED, {
      teamId: 't1',
      title: 'Unify Linear connections',
      description: 'body',
    })
    expect(createIssue).toHaveBeenCalledWith({
      teamId: 't1',
      title: 'Unify Linear connections',
      description: 'body',
    })
    expect(issue?.key).toBe('TAV-42')
    expect(issue?.branchName).toBe('andrew/tav-42-unify-linear')
  })

  it('rejects when Linear reports the create failed', async () => {
    const createIssue = vi.fn().mockResolvedValue({ success: false })
    await expect(
      providerWith({ createIssue }).create?.(CRED, { teamId: 't1', title: 'x', description: '' })
    ).rejects.toMatchObject({ kind: 'failed' })
  })

  it('rejects when Linear succeeds but hands back no issue', async () => {
    const createIssue = vi.fn().mockResolvedValue({ success: true, issue: undefined })
    await expect(
      providerWith({ createIssue }).create?.(CRED, { teamId: 't1', title: 'x', description: '' })
    ).rejects.toMatchObject({ kind: 'failed' })
  })
})
