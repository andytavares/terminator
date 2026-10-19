import { describe, it, expect } from 'vitest'
import { checksOf, reviewRequestedAtOf } from '../../src/github/dashboard-checks'

interface CheckRunNode {
  name: string
  status: string
  conclusion: string | null
}

const checkRunNode = ({ name, status, conclusion }: CheckRunNode) => ({
  __typename: 'CheckRun',
  name,
  status,
  conclusion,
  detailsUrl: `https://github.com/acme/widgets/actions/runs/1/job/${name}`,
  completedAt: '2026-10-18T08:00:00Z',
})

describe('checksOf', () => {
  it('maps a check run by status and conclusion', () => {
    const nodes = [
      checkRunNode({ name: 'unit', status: 'COMPLETED', conclusion: 'SUCCESS' }),
      checkRunNode({ name: 'e2e', status: 'COMPLETED', conclusion: 'FAILURE' }),
      checkRunNode({ name: 'lint', status: 'COMPLETED', conclusion: 'SKIPPED' }),
      checkRunNode({ name: 'build', status: 'IN_PROGRESS', conclusion: null }),
      checkRunNode({ name: 'slow', status: 'COMPLETED', conclusion: 'TIMED_OUT' }),
    ]
    expect(checksOf(nodes).map((c) => [c.name, c.state])).toEqual([
      ['unit', 'passed'],
      ['e2e', 'failed'],
      ['lint', 'passed'],
      ['build', 'running'],
      ['slow', 'failed'],
    ])
  })

  it('keeps the details link and the time a check finished', () => {
    const [check] = checksOf([
      checkRunNode({ name: 'e2e', status: 'COMPLETED', conclusion: 'FAILURE' }),
    ])
    expect(check).toEqual({
      name: 'e2e',
      state: 'failed',
      detailsUrl: 'https://github.com/acme/widgets/actions/runs/1/job/e2e',
      completedAt: '2026-10-18T08:00:00Z',
    })
  })
})

describe('checksOf: commit statuses', () => {
  it('maps a commit status by its state, named by its context', () => {
    const nodes = [
      {
        __typename: 'StatusContext',
        context: 'ci/legacy',
        state: 'FAILURE',
        targetUrl: 'https://ci/1',
      },
      { __typename: 'StatusContext', context: 'ci/wait', state: 'PENDING', targetUrl: null },
    ]
    expect(checksOf(nodes)).toEqual([
      { name: 'ci/legacy', state: 'failed', detailsUrl: 'https://ci/1' },
      { name: 'ci/wait', state: 'running' },
    ])
  })

  it('has no checks when GitHub sent none', () => {
    expect(checksOf(undefined)).toEqual([])
  })
})

describe('reviewRequestedAtOf', () => {
  const event = (createdAt: string, login: string | null) => ({
    createdAt,
    requestedReviewer: login ? { login } : null,
  })

  it('takes the latest request that named the viewer', () => {
    const events = [
      event('2026-10-10T00:00:00Z', 'alice'),
      event('2026-10-12T00:00:00Z', 'alice'),
      event('2026-10-17T00:00:00Z', 'bob'),
    ]
    expect(reviewRequestedAtOf(events, 'alice')).toBe('2026-10-12T00:00:00Z')
  })

  it('falls back to the latest request of any reviewer, such as a team', () => {
    expect(reviewRequestedAtOf([event('2026-10-17T00:00:00Z', null)], 'alice')).toBe(
      '2026-10-17T00:00:00Z'
    )
  })

  it('has no time when there was no request event', () => {
    expect(reviewRequestedAtOf([], 'alice')).toBeUndefined()
  })
})
