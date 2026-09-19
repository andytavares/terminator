import { describe, it, expect } from 'vitest'
import {
  frecencyScore,
  rankFirstScreen,
  orderGroups,
} from '../../../../src/renderer/quick-actions/rank'
import type { QuickAction, QuickActionGroup } from '../../../../src/renderer/quick-actions/types'
import type { ActionUsage } from '../../../../src/shared/types'

const DAY = 24 * 60 * 60 * 1000

function action(id: string, group = 'terminal'): QuickAction {
  return { id, label: id, group, run: () => {} }
}

describe('frecencyScore', () => {
  const now = 1_000_000_000_000

  it('weights usage within 4 days the highest', () => {
    const recent: ActionUsage = { id: 'a', count: 2, lastUsedAt: now - 1 * DAY }
    const old: ActionUsage = { id: 'b', count: 2, lastUsedAt: now - 50 * DAY }
    expect(frecencyScore(recent, now)).toBeGreaterThan(frecencyScore(old, now))
  })

  it('scores decrease monotonically with age for the same count', () => {
    const within4 = frecencyScore({ id: 'a', count: 1, lastUsedAt: now - 3 * DAY }, now)
    const within14 = frecencyScore({ id: 'a', count: 1, lastUsedAt: now - 10 * DAY }, now)
    const within60 = frecencyScore({ id: 'a', count: 1, lastUsedAt: now - 30 * DAY }, now)
    const older = frecencyScore({ id: 'a', count: 1, lastUsedAt: now - 90 * DAY }, now)
    expect(within4).toBeGreaterThan(within14)
    expect(within14).toBeGreaterThan(within60)
    expect(within60).toBeGreaterThan(older)
  })

  it('scales with count', () => {
    const one = frecencyScore({ id: 'a', count: 1, lastUsedAt: now }, now)
    const five = frecencyScore({ id: 'a', count: 5, lastUsedAt: now }, now)
    expect(five).toBeGreaterThan(one)
  })
})

describe('rankFirstScreen', () => {
  const now = 1_000_000_000_000
  const actions = [action('a'), action('b'), action('c'), action('d'), action('e')]

  it('follows pin order regardless of usage', () => {
    const { pinned } = rankFirstScreen(actions, { pins: ['c', 'a'], usage: [], now })
    expect(pinned.map((a) => a.id)).toEqual(['c', 'a'])
  })

  it('ignores pinned ids no longer present in actions', () => {
    const { pinned } = rankFirstScreen(actions, { pins: ['zzz', 'a'], usage: [], now })
    expect(pinned.map((a) => a.id)).toEqual(['a'])
  })

  it('ranks recent by highest frecency, excluding pinned', () => {
    const usage: ActionUsage[] = [
      { id: 'a', count: 10, lastUsedAt: now },
      { id: 'b', count: 1, lastUsedAt: now - 90 * DAY },
      { id: 'c', count: 5, lastUsedAt: now },
    ]
    const { recent } = rankFirstScreen(actions, { pins: ['a'], usage, now })
    expect(recent[0].id).toBe('c')
    expect(recent.map((a) => a.id)).not.toContain('a')
  })

  it('drops stale usage ids that are no longer live actions', () => {
    const usage: ActionUsage[] = [{ id: 'ghost', count: 100, lastUsedAt: now }]
    const { recent } = rankFirstScreen(actions, { pins: [], usage, now })
    expect(recent.map((a) => a.id)).not.toContain('ghost')
  })

  it('limits the recent row to the given limit, defaulting to 4', () => {
    const usage: ActionUsage[] = actions.map((a) => ({ id: a.id, count: 1, lastUsedAt: now }))
    const { recent } = rankFirstScreen(actions, { pins: [], usage, now })
    expect(recent.length).toBe(4)
    const { recent: limited } = rankFirstScreen(actions, { pins: [], usage, now, limit: 2 })
    expect(limited.length).toBe(2)
  })
})

describe('orderGroups', () => {
  const groups: QuickActionGroup[] = [
    { id: 'terminal', mnemonic: 't', label: 'Terminal' },
    { id: 'sessions', mnemonic: 's', label: 'Sessions' },
    { id: 'ext:foundry', mnemonic: 'f', label: 'Foundry' },
  ]

  it('puts the context group first and keeps the rest in order', () => {
    const ordered = orderGroups(groups, 'ext:foundry')
    expect(ordered.map((g) => g.id)).toEqual(['ext:foundry', 'terminal', 'sessions'])
  })

  it('keeps original order when there is no context group', () => {
    const ordered = orderGroups(groups, null)
    expect(ordered.map((g) => g.id)).toEqual(['terminal', 'sessions', 'ext:foundry'])
  })

  it('keeps original order when the context group id is unknown', () => {
    const ordered = orderGroups(groups, 'ext:unknown')
    expect(ordered.map((g) => g.id)).toEqual(['terminal', 'sessions', 'ext:foundry'])
  })
})
