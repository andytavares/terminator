import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { createChangeBus } from '../helpers/change-bus.js'
import { RepositoryChecks } from '../../src/components/SettingsProfiles.js'
import { payloadsSentOn } from '../helpers/bridge-calls.js'
import { glyphProfile } from '../helpers/profile.js'

// Settings lists the repositories Foundry holds commands for, and lets the operator
// look at one or forget it. The next order on a forgotten repository proposes again.

let invoke: ReturnType<typeof vi.fn>
let listed: unknown[]
const bus = createChangeBus()

const GLYPH = {
  repository: '/repos/glyph-compiler',
  commands: 5,
  proofCommit: '4be1c09aaaa',
  provedAt: '2026-10-21T12:00:00.000Z',
}
const LEDGER = {
  repository: '/repos/ledger-service',
  commands: 3,
  proofCommit: null,
  provedAt: null,
}

beforeEach(() => {
  listed = [GLYPH, LEDGER]
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'foundry:profiles-list') return { profiles: listed }
    if (channel === 'foundry:profile-read') return glyphProfile({ repository: GLYPH.repository })
    if (channel === 'foundry:profile-forget') {
      listed = listed.filter((each) => (each as typeof GLYPH).repository !== GLYPH.repository)
      return { ok: true }
    }
    return {}
  })
  Object.defineProperty(window, 'electronAPI', {
    value: { extensionBridge: { invoke, on: bus.on }, usage: { record: vi.fn() } },
    configurable: true,
    writable: true,
  })
})

describe('Repository checks in settings', () => {
  it('lists each repository with its commands and when they were last proven', async () => {
    render(<RepositoryChecks />)
    const glyph = within(await screen.findByRole('group', { name: 'glyph-compiler' }))
    expect(
      glyph.getByText(/\/repos\/glyph-compiler · 5 commands · proven at 4be1c09 on 21 Oct/)
    ).toBeTruthy()
    const ledger = within(screen.getByRole('group', { name: 'ledger-service' }))
    expect(ledger.getByText(/3 commands · never proven/)).toBeTruthy()
  })

  it('says so when no repository has a profile yet', async () => {
    listed = []
    render(<RepositoryChecks />)
    expect(await screen.findByText(/No repository has checks yet/)).toBeTruthy()
  })
})

describe('looking at and forgetting a repository', () => {
  it('shows the commands of one repository, read only', async () => {
    render(<RepositoryChecks />)
    const glyph = within(await screen.findByRole('group', { name: 'glyph-compiler' }))
    fireEvent.click(glyph.getByRole('button', { name: 'Show' }))
    expect(await glyph.findByText('./glyph test')).toBeTruthy()
    expect(payloadsSentOn(invoke, 'foundry:profile-read')).toEqual([
      { repoPath: '/repos/glyph-compiler' },
    ])
    expect(glyph.queryByRole('textbox')).toBeNull()
  })

  it('forgets a repository and drops it from the list', async () => {
    render(<RepositoryChecks />)
    const glyph = within(await screen.findByRole('group', { name: 'glyph-compiler' }))
    fireEvent.click(glyph.getByRole('button', { name: 'Forget' }))
    await waitFor(() => expect(screen.queryByRole('group', { name: 'glyph-compiler' })).toBeNull())
    expect(payloadsSentOn(invoke, 'foundry:profile-forget')).toEqual([
      { repoPath: '/repos/glyph-compiler' },
    ])
    expect(screen.getByRole('group', { name: 'ledger-service' })).toBeTruthy()
  })
})
