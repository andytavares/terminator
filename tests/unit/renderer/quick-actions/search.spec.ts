import { describe, it, expect } from 'vitest'
import { MAX_RESULTS, searchActions } from '../../../../src/renderer/quick-actions/search'
import type { QuickAction, QuickActionGroup } from '../../../../src/renderer/quick-actions/types'

const groups: QuickActionGroup[] = [
  { id: 'git', mnemonic: 'g', label: 'Git' },
  { id: 'terminal', mnemonic: 't', label: 'Terminal' },
]

function action(
  id: string,
  label: string,
  { group, description }: Pick<QuickAction, 'group' | 'description'>
): QuickAction {
  return { id, label, group, description, run: () => {} }
}

const actions: QuickAction[] = [
  action('git.push', 'Push', { group: 'git', description: 'Push the current branch' }),
  action('git.pull', 'Pull', { group: 'git' }),
  action('terminal.new-tab', 'New tab', { group: 'terminal' }),
  action('terminal.split', 'Split right', {
    group: 'terminal',
    description: 'Push output to a new pane',
  }),
]

describe('searchActions', () => {
  it('returns nothing for an empty query', () => {
    expect(searchActions(actions, groups, '')).toEqual([])
  })

  it('matches through the group label', () => {
    // Neither git label contains "git"; the group label does. "Split right
    // terminal" holds g, i and t in order, so it matches as a subsequence.
    const results = searchActions(actions, groups, 'git')
    expect(results.map((a) => a.id)).toEqual(['git.push', 'git.pull', 'terminal.split'])
  })

  it('matches through the description', () => {
    const results = searchActions(actions, groups, 'pane')
    expect(results.map((a) => a.id)).toEqual(['terminal.split'])
  })

  it('ranks a label substring match before a label subsequence-only match', () => {
    const items = [
      action('a', 'Terminal split', { group: 'terminal' }),
      action('b', 'S p l i t up the terminal', { group: 'terminal' }),
    ]
    const results = searchActions(items, groups, 'split')
    expect(results.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('is case-insensitive', () => {
    const results = searchActions(actions, groups, 'PUSH')
    expect(results.map((a) => a.id)).toContain('git.push')
  })

  it('does a subsequence fuzzy match over the combined text', () => {
    const results = searchActions(actions, groups, 'ntab')
    expect(results.map((a) => a.id)).toContain('terminal.new-tab')
  })
})

describe('searchActions — excludes actions that do not match at all', () => {
  it('excludes actions that do not match at all', () => {
    const results = searchActions(actions, groups, 'zzzzz')
    expect(results).toEqual([])
  })

  it('shows at most MAX_RESULTS matches, the first ones in order', () => {
    const many = Array.from({ length: MAX_RESULTS + 5 }, (_, i) =>
      action(`a${i}`, `Echo ${i}`, { group: 'terminal' })
    )
    const results = searchActions(many, groups, 'echo')
    expect(results).toHaveLength(MAX_RESULTS)
    expect(results[0].id).toBe('a0')
  })
})
