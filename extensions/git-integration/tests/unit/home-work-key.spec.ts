import { describe, it, expect } from 'vitest'
import { parseTicketKey, workKeyOf } from '../../src/home/work-key'
import type { TicketIndex } from '../../src/home/work-key'
import { dashboardPrFixture } from './support/dashboard-pr'

describe('parseTicketKey', () => {
  it.each([
    ['tav-20-pr-overview', 'TAV-20'],
    ['feat/TAV-20-pr-overview', 'TAV-20'],
    ['Fix the cache (ENG-1234)', 'ENG-1234'],
    ['a2b-7 follow-up', 'A2B-7'],
  ])('finds the key in %s', (text, key) => {
    expect(parseTicketKey(text)).toBe(key)
  })

  it.each(['fix/login-redirect', 'no ticket here', 'T-5 too short', ''])(
    'finds no key in %j',
    (text) => {
      expect(parseTicketKey(text)).toBeNull()
    }
  )
})

const MY_ISSUES: TicketIndex = new Map([
  ['TAV-20', 'linear'],
  ['ENG-9', 'linear'],
])

describe('workKeyOf', () => {
  it('prefers the branch name ticket over the title ticket', () => {
    const pr = dashboardPrFixture({ headRefName: 'tav-20-pr-overview', title: 'ENG-9 Overview' })
    expect(workKeyOf(pr, MY_ISSUES)).toEqual({ tracker: 'linear', key: 'TAV-20' })
  })

  it('falls back to the title ticket', () => {
    const pr = dashboardPrFixture({ headRefName: 'fix/cache', title: 'ENG-9 Fix the cache' })
    expect(workKeyOf(pr, MY_ISSUES)).toEqual({ tracker: 'linear', key: 'ENG-9' })
  })

  it('falls back to the checkout and branch', () => {
    const pr = dashboardPrFixture({ headRefName: 'fix/cache', title: 'Fix the cache' })
    expect(workKeyOf(pr, MY_ISSUES)).toEqual({ repoRoot: '/work/widgets', branch: 'fix/cache' })
  })

  it('has no key for a branch with no ticket and no local checkout', () => {
    const pr = dashboardPrFixture({ headRefName: 'fix/cache', title: 'Fix', localRepoRoot: null })
    expect(workKeyOf(pr, MY_ISSUES)).toBeNull()
  })

  it.each(['utf-8-fix', 'pr-12'])('keys %s by its branch, not as a ticket', (headRefName) => {
    const pr = dashboardPrFixture({ headRefName, title: 'Fix' })
    expect(workKeyOf(pr, MY_ISSUES)).toEqual({ repoRoot: '/work/widgets', branch: headRefName })
  })

  it('keys by branch when the user has no issues, such as no tracker connected', () => {
    const pr = dashboardPrFixture({ headRefName: 'tav-20-pr-overview' })
    expect(workKeyOf(pr, new Map())).toEqual({
      repoRoot: '/work/widgets',
      branch: 'tav-20-pr-overview',
    })
  })
})
