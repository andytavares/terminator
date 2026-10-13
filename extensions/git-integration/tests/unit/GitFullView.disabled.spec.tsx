import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GitFullView } from '../../src/components/GitFullView'
import { useGitStore } from '../../src/stores/git.store'
import { installElectronApi } from '../../../../tests/support/electron-api'

// A workspace that switched "Enable Git Integration" off gets GIT_DISABLED
// from git:status; the Git view says so instead of loading for ever.

function answerStatusWith(answer: unknown) {
  const invoke = vi.fn(async (channel: string) => (channel === 'git:status' ? answer : {}))
  installElectronApi({
    extensionBridge: { invoke, on: () => () => {} },
    fs: { onChanged: () => () => {} },
  })
}

beforeEach(() => {
  useGitStore.setState(useGitStore.getInitialState(), true)
})

describe('GitFullView in a workspace that switched Git Integration off', () => {
  it('says Git Integration is off for this workspace', async () => {
    answerStatusWith({ error: 'GIT_DISABLED' })
    render(<GitFullView repoRoot="/code/api" />)

    expect(await screen.findByText('Git Integration is off for this workspace.')).toBeTruthy()
  })

  it('shows the changes again once the workspace switches it back on', async () => {
    answerStatusWith({ branch: 'main', files: [], truncated: false, hasConflicts: false })
    render(<GitFullView repoRoot="/code/api" />)

    expect(await screen.findByText('Commit')).toBeTruthy()
    expect(screen.queryByText('Git Integration is off for this workspace.')).toBeNull()
  })
})
