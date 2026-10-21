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

  it('skips a team with no id and names the rest from what Linear gave', async () => {
    const teams = vi.fn().mockResolvedValue({ nodes: [{ key: 'X', name: 'No id' }, { id: 't3' }] })
    const provider = providerWith({ viewer: Promise.resolve({ name: 'A', email: 'a@b.c', teams }) })
    await expect(provider.teams?.(CRED)).resolves.toEqual([{ id: 't3', key: '', name: 't3' }])
  })
})

describe('linear provider — teams without an accessor', () => {
  it('lists no teams when the viewer has no teams accessor', async () => {
    const provider = providerWith({ viewer: Promise.resolve({ name: 'A', email: 'a@b.c' }) })
    await expect(provider.teams?.(CRED)).resolves.toEqual([])
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
})

const created = () =>
  vi.fn().mockResolvedValue({ success: true, issue: Promise.resolve(makeIssue()) })
const NEW_ISSUE = { teamId: 't1', title: 'Unify', description: 'body' }

describe('linear provider — create assigns the configured user', () => {
  it('assigns the new issue to the user found by the configured email, not the key owner', async () => {
    const createIssue = created()
    const users = vi.fn().mockResolvedValue({ nodes: [{ id: 'user-andrew' }] })
    await providerWith({ createIssue, users }).create?.(CRED, {
      ...NEW_ISSUE,
      assigneeEmail: 'andrew.tavares@klaviyo.com',
    })
    expect(users).toHaveBeenCalledWith({
      filter: { email: { eq: 'andrew.tavares@klaviyo.com' } },
      first: 1,
    })
    expect(createIssue).toHaveBeenCalledWith(expect.objectContaining({ assigneeId: 'user-andrew' }))
  })
})

describe('linear provider — create with an unknown or absent assignee', () => {
  it('refuses to file the issue when no user has that email, rather than leaving it on the key owner', async () => {
    const createIssue = created()
    const users = vi.fn().mockResolvedValue({ nodes: [] })
    await expect(
      providerWith({ createIssue, users }).create?.(CRED, {
        ...NEW_ISSUE,
        assigneeEmail: 'nobody@x.c',
      })
    ).rejects.toMatchObject({ kind: 'failed' })
    expect(createIssue).not.toHaveBeenCalled()
  })

  it('leaves the issue unassigned and looks nobody up when no email is configured', async () => {
    const createIssue = created()
    const users = vi.fn()
    await providerWith({ createIssue, users }).create?.(CRED, { ...NEW_ISSUE, assigneeEmail: null })
    expect(users).not.toHaveBeenCalled()
    expect(createIssue.mock.calls[0][0]).not.toHaveProperty('assigneeId')
  })
})

describe('linear provider — create refusals', () => {
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
