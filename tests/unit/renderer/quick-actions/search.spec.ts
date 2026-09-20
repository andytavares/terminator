import { describe, it, expect } from 'vitest'
import { searchActions } from '../../../../src/renderer/quick-actions/search'
import type { QuickAction, QuickActionGroup } from '../../../../src/renderer/quick-actions/types'

const groups: QuickActionGroup[] = [
  { id: 'git', mnemonic: 'g', label: 'Git' },
  { id: 'terminal', mnemonic: 't', label: 'Terminal' },
]

function action(id: string, label: string, group: string, description?: string): QuickAction {
  return { id, label, group, description, run: () => {} }
}

describe('searchActions', () => {
  const actions: QuickAction[] = [
    action('git.push', 'Push', 'git', 'Push the current branch'),
    action('git.pull', 'Pull', 'git'),
    action('terminal.new-tab', 'New tab', 'terminal'),
    action('terminal.split', 'Split right', 'terminal', 'Push output to a new pane'),
  ]

  it('returns nothing for an empty query', () => {
    expect(searchActions(actions, groups, '', 50)).toEqual([])
  })

  it('matches through the group label', () => {
    const results = searchActions(actions, groups, 'push', 50)
    expect(results.map((a) => a.id)).toContain('git.push')
  })

  it('matches through the description', () => {
    const results = searchActions(actions, groups, 'pane', 50)
    expect(results.map((a) => a.id)).toEqual(['terminal.split'])
  })

  it('ranks a label substring match before a label subsequence-only match', () => {
    const items = [
      action('a', 'Terminal split', 'terminal'),
      action('b', 'S p l i t up the terminal', 'terminal'),
    ]
    const results = searchActions(items, groups, 'split', 50)
    expect(results.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('is case-insensitive', () => {
    const results = searchActions(actions, groups, 'PUSH', 50)
    expect(results.map((a) => a.id)).toContain('git.push')
  })

  it('does a subsequence fuzzy match over the combined text', () => {
    const results = searchActions(actions, groups, 'ntab', 50)
    expect(results.map((a) => a.id)).toContain('terminal.new-tab')
  })

  it('excludes actions that do not match at all', () => {
    const results = searchActions(actions, groups, 'zzzzz', 50)
    expect(results).toEqual([])
  })

  it('respects the limit', () => {
    const results = searchActions(actions, groups, 'e', 2)
    expect(results.length).toBeLessThanOrEqual(2)
  })
})
