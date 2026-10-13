import { describe, it, expect } from 'vitest'
import { allocateExtensionGroups } from '../../../../src/renderer/quick-actions/groups'
import { findMnemonicConflicts } from '../../../support/quick-actions'
import type { QuickAction, QuickActionGroup } from '../../../../src/renderer/quick-actions/types'

function action(id: string, group: string, mnemonic?: string): QuickAction {
  return { id, label: id, group, mnemonic, run: () => {} }
}

describe('allocateExtensionGroups', () => {
  it('takes the requested letter when free', () => {
    const { groups, warnings } = allocateExtensionGroups([
      { extensionId: 'git-integration', mnemonic: 'g', label: 'Git' },
    ])
    expect(groups).toEqual([
      { id: 'ext:git-integration', mnemonic: 'g', label: 'Git', owner: 'git-integration' },
    ])
    expect(warnings).toEqual([])
  })

  it('falls back to the first free letter of the label when the requested letter is taken', () => {
    const { groups, warnings } = allocateExtensionGroups([
      { extensionId: 'git-integration', mnemonic: 'g', label: 'Git' },
      { extensionId: 'gadgets', mnemonic: 'g', label: 'Gadgets' },
    ])
    expect(groups[0].mnemonic).toBe('g')
    // 'g' is taken, and 'a' is a reserved core letter, so the next free
    // letter of "Gadgets" is 'd'.
    expect(groups[1].mnemonic).toBe('d')
    expect(warnings).toEqual([
      '"gadgets" wanted mnemonic "g" but it was taken by "git-integration"; assigned "d" instead.',
    ])
  })

  it('falls back to the first free a-z letter when no letter of the label is free', () => {
    const { groups, warnings } = allocateExtensionGroups([
      { extensionId: 'one', mnemonic: 'p', label: 'Ppp' },
      { extensionId: 'two', mnemonic: 'p', label: 'Ppp' },
    ])
    expect(groups[0].mnemonic).toBe('p')
    // 'p' is taken and the label has no other letters, so it falls to the
    // first globally free a-z letter, skipping the reserved 'a' and 'b'.
    expect(groups[1].mnemonic).toBe('c')
    expect(warnings).toHaveLength(1)
  })

  it('reserves core group and top-level letters against extensions', () => {
    const { groups, warnings } = allocateExtensionGroups([
      { extensionId: 'terminal-plus', mnemonic: 't', label: 'Terminal plus' },
    ])
    // 't' is the Terminal group's letter; 'e' is the next letter of the label.
    expect(groups[0].mnemonic).toBe('e')
    expect(warnings).toEqual([
      '"terminal-plus" wanted mnemonic "t" but it was taken; assigned "e" instead.',
    ])
  })

  it('assigns no group when every a-z letter is exhausted', () => {
    const requests = Array.from({ length: 26 }, (_, i) => ({
      extensionId: `ext-${i}`,
      mnemonic: String.fromCharCode(97 + i),
      label: `Ext${i}`,
    }))
    // Core reserves t, s, w, x, h, o, a and b, so only 18 letters are left
    // for 27 requests.
    requests.push({ extensionId: 'overflow', mnemonic: 'a', label: 'Aaa' })
    const { groups, warnings } = allocateExtensionGroups(requests)
    expect(groups).toHaveLength(18)
    expect(warnings.at(-1)).toBe('"overflow" wanted mnemonic "a" but no group letter was free.')
  })

  it('is case-sensitive: a lowercase and uppercase mnemonic do not collide', () => {
    const { groups, warnings } = allocateExtensionGroups([
      { extensionId: 'one', mnemonic: 'g', label: 'Git' },
      { extensionId: 'two', mnemonic: 'G', label: 'Grid' },
    ])
    expect(groups[0].mnemonic).toBe('g')
    expect(groups[1].mnemonic).toBe('G')
    expect(warnings).toEqual([])
  })

  it('falls back to the first free label letter when no mnemonic is requested', () => {
    const { groups } = allocateExtensionGroups([{ extensionId: 'notes', label: 'Notes' }])
    expect(groups[0].mnemonic).toBe('n')
  })
})

describe('findMnemonicConflicts', () => {
  const groups: QuickActionGroup[] = [
    { id: 'terminal', mnemonic: 't', label: 'Terminal' },
    { id: 'sessions', mnemonic: 's', label: 'Sessions' },
  ]

  it('reports a duplicate mnemonic within the same group', () => {
    const actions = [action('a1', 'terminal', 'd'), action('a2', 'terminal', 'd')]
    expect(findMnemonicConflicts(actions, groups)).toEqual([
      'Group "terminal" has duplicate mnemonic "d" on: a1, a2.',
    ])
  })

  it('is case-sensitive: d and D in the same group do not conflict', () => {
    const actions = [action('a1', 'terminal', 'd'), action('a2', 'terminal', 'D')]
    expect(findMnemonicConflicts(actions, groups)).toEqual([])
  })

  it('does not report a conflict for the same mnemonic in different groups', () => {
    const actions = [action('a1', 'terminal', 'd'), action('a2', 'sessions', 'd')]
    expect(findMnemonicConflicts(actions, groups)).toEqual([])
  })

  it('reports a top-level action colliding with a group letter', () => {
    const actions = [action('a1', 'top', 't')]
    expect(findMnemonicConflicts(actions, groups)).toEqual([
      'Top-level action "a1" uses mnemonic "t", which is also a group letter.',
    ])
  })
})
