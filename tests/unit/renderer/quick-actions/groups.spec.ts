import { describe, it, expect } from 'vitest'
import {
  CORE_GROUPS,
  CORE_TOP_MNEMONICS,
  allocateExtensionGroups,
  findMnemonicConflicts,
} from '../../../../src/renderer/quick-actions/groups'
import type { QuickAction, QuickActionGroup } from '../../../../src/renderer/quick-actions/types'

function action(id: string, group: string, mnemonic?: string): QuickAction {
  return { id, label: id, group, mnemonic, run: () => {} }
}

describe('CORE_GROUPS', () => {
  it('defines terminal, sessions, workspace and custom with their mnemonics', () => {
    const byId = Object.fromEntries(CORE_GROUPS.map((g) => [g.id, g]))
    expect(byId.terminal).toEqual({ id: 'terminal', mnemonic: 't', label: 'Terminal' })
    expect(byId.sessions).toEqual({ id: 'sessions', mnemonic: 's', label: 'Sessions' })
    expect(byId.workspace).toEqual({ id: 'workspace', mnemonic: 'w', label: 'Workspace' })
    expect(byId.custom).toEqual({ id: 'custom', mnemonic: 'x', label: 'Custom' })
  })
})

describe('CORE_TOP_MNEMONICS', () => {
  it('reserves the direct top-level action letters', () => {
    expect(CORE_TOP_MNEMONICS).toEqual(new Set(['h', 'o', 'a', 'b', ',', '/']))
  })
})

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
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/git-integration/)
    expect(warnings[0]).toMatch(/gadgets/)
    expect(warnings[0]).toMatch(/g/)
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
    expect(groups[0].mnemonic).not.toBe('t')
    expect(warnings).toHaveLength(1)
  })

  it('assigns no group when every a-z letter is exhausted', () => {
    const requests = Array.from({ length: 26 }, (_, i) => ({
      extensionId: `ext-${i}`,
      mnemonic: String.fromCharCode(97 + i),
      label: `Ext${i}`,
    }))
    // Core already reserves t, s, w, x, h, o, a, b — so 8 of the 26 letters
    // are unavailable to extensions, leaving fewer slots than requests when
    // every extension also collides on its own label-derived fallback.
    requests.push({ extensionId: 'overflow', mnemonic: 'a', label: 'Aaa' })
    const { groups, warnings } = allocateExtensionGroups(requests)
    expect(groups.length).toBeLessThan(requests.length)
    expect(warnings.some((w) => /no group/i.test(w))).toBe(true)
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
    const conflicts = findMnemonicConflicts(actions, groups)
    expect(conflicts.length).toBeGreaterThan(0)
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
    const conflicts = findMnemonicConflicts(actions, groups)
    expect(conflicts.length).toBeGreaterThan(0)
  })
})
