import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PrReviewTab } from '../../src/components/pr-review/PrReviewTab'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import { githubAPI } from '../../src/api/github'
import { PrReviewDetailSchema } from '../../src/schemas/pr-review.schema'
import { reviewQueuePr } from './support/review-queue-pr'

vi.mock('../../src/api/github', () => ({
  githubAPI: {
    prReviewDetail: vi.fn(),
    sessionGet: vi.fn(),
    sessionSet: vi.fn(),
    saveActiveReview: vi.fn(),
  },
}))

// The real detail load runs; the queue and the background loads are not what this file tests.
vi.mock('../../src/hooks/usePrReview', async (importActual) => ({
  ...(await importActual<typeof import('../../src/hooks/usePrReview')>()),
  useLoadPrQueue: () => async () => {},
  useFetchFileMetrics: () => async () => {},
  useLoadIssueComments: () => async () => {},
}))

vi.mock('../../src/components/pr-review/PrOverviewPanel', () => ({
  PrOverviewPanel: ({ pr }: { pr: { number: number } }) => <h2>Overview of #{pr.number}</h2>,
}))

vi.mock('../../src/components/pr-review/PrReviewView', () => ({
  PrReviewView: ({ pr }: { pr: { number: number } }) => <h2>Review of #{pr.number}</h2>,
}))

const detailOf3 = PrReviewDetailSchema.parse({
  number: 3,
  title: 'PR 3',
  body: '',
  author: 'alice',
  authorAvatarUrl: '',
  openedAt: '2025-01-01T00:00:00Z',
  headRefName: 'feat',
  baseRefName: 'main',
  headSHA: 'abc123',
  ciStatus: 'passing',
  lintStatus: 'pass',
  coverageStatus: 'pass',
  chapters: [],
})

const openExternal = vi.fn()

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(githubAPI.sessionGet).mockResolvedValue({ session: {} })
  vi.mocked(githubAPI.saveActiveReview).mockResolvedValue({ ok: true })
  openExternal.mockResolvedValue(undefined)
  usePrReviewStore.getState().reset()
  vi.stubGlobal('electronAPI', {
    extensionBridge: { invoke: vi.fn().mockResolvedValue({}), on: () => () => {} },
    shell: { openExternal },
  })
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

/** The project's review list, holding PR 3 not yet started, with PR 3's detail failing first. */
async function clickReviewOnFailingRow() {
  usePrReviewStore.setState({ prQueue: [{ ...reviewQueuePr(3), sessionStatus: 'not-started' }] })
  vi.mocked(githubAPI.prReviewDetail).mockResolvedValueOnce({ error: 'gh: HTTP 502 Bad Gateway' })
  const user = userEvent.setup()
  render(<PrReviewTab repoRoot="/repo" />)
  const row = screen.getByRole('group', { name: '#3 PR 3' })
  await user.click(within(row).getByRole('button', { name: 'Review' }))
  return { user, alert: await screen.findByRole('alert') }
}

describe('opening a pull request from the project review list', () => {
  it('shows under its row why the pull request did not open', async () => {
    const { alert } = await clickReviewOnFailingRow()
    expect(alert.textContent).toContain('Could not open #3.')
    expect(alert.textContent).toContain('gh: HTTP 502 Bad Gateway')
  })

  it('opens the pull request when Retry follows a recovered reply', async () => {
    const { user, alert } = await clickReviewOnFailingRow()
    vi.mocked(githubAPI.prReviewDetail).mockResolvedValueOnce({ pr: detailOf3 })
    await user.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Overview of #3' })).toBeTruthy()
  })
})

/** A pop-out window opened for PR 3 of `repoRoot`, whose detail load answers with `reply`. */
function renderPopout(repoRoot: string | null, reply: Promise<unknown>) {
  window.history.replaceState(null, '', '/?view=pr-review&prNumber=3&showOverview=true')
  vi.mocked(githubAPI.prReviewDetail).mockReturnValue(reply as never)
  render(<PrReviewTab repoRoot={repoRoot} />)
}

describe('a pop-out window opened for a pull request', () => {
  it('shows the opening screen on its first render, never the list', async () => {
    renderPopout('/repo', new Promise(() => {}))
    expect(screen.getByRole('heading', { name: 'Opening pull request #3' })).toBeTruthy()
    expect(screen.getByText('Loading files, checks and chapters')).toBeTruthy()
    expect(screen.queryByLabelText('Search pull requests')).toBeNull()
  })

  it('shows why the pull request did not open after a failed load', async () => {
    renderPopout('/repo', Promise.resolve({ error: 'gh: HTTP 502 Bad Gateway' }))
    const heading = await screen.findByRole('heading', { name: 'Could not open pull request #3' })
    expect(heading).toBeTruthy()
    expect(screen.getByText('gh: HTTP 502 Bad Gateway')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open on GitHub' })).toBeNull()
  })

  it('opens the pull request when Retry follows a recovered reply', async () => {
    renderPopout('/repo', Promise.resolve({ error: 'gh: HTTP 502 Bad Gateway' }))
    await screen.findByRole('heading', { name: 'Could not open pull request #3' })
    vi.mocked(githubAPI.prReviewDetail).mockResolvedValue({ pr: detailOf3 })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Overview of #3' })).toBeTruthy()
  })

  it('says no repository was given, at once, when its URL names none', () => {
    renderPopout(null, new Promise(() => {}))
    expect(screen.getByRole('heading', { name: 'Could not open pull request #3' })).toBeTruthy()
    expect(screen.getByText('No repository given')).toBeTruthy()
  })
})

describe('a pop-out window whose pull request did not open', () => {
  it('opens the pull request on GitHub from a gh:owner/name repository', async () => {
    renderPopout('gh:acme/app', Promise.resolve({ error: 'gh: HTTP 502 Bad Gateway' }))
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Open on GitHub' }))
    expect(openExternal).toHaveBeenCalledWith('https://github.com/acme/app/pull/3')
  })

  it('shows the review list after Show all pull requests', async () => {
    renderPopout('/repo', Promise.resolve({ error: 'gh: HTTP 502 Bad Gateway' }))
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Show all pull requests' }))
    expect(screen.getByLabelText('Search pull requests')).toBeTruthy()
  })
})
