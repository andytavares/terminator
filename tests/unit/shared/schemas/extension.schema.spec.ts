import { describe, it, expect } from 'vitest'
import { ExtensionContributesSchema } from '../../../../src/shared/schemas/extension.schema'

describe('ExtensionContributesSchema — quick actions', () => {
  it('accepts a quickActions group with a one-char mnemonic', () => {
    const result = ExtensionContributesSchema.safeParse({
      quickActions: { group: { mnemonic: 'g', label: 'Git' } },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.quickActions).toEqual({ group: { mnemonic: 'g', label: 'Git' } })
    }
  })

  it('accepts a quickActions group without a mnemonic', () => {
    const result = ExtensionContributesSchema.safeParse({
      quickActions: { group: { label: 'Git' } },
    })
    expect(result.success).toBe(true)
  })

  it('rejects a mnemonic longer than one character', () => {
    const result = ExtensionContributesSchema.safeParse({
      quickActions: { group: { mnemonic: 'gi', label: 'Git' } },
    })
    expect(result.success).toBe(false)
  })

  it('preserves quickActions through the transform alongside other keys', () => {
    const result = ExtensionContributesSchema.safeParse({
      globalTab: { label: 'Git' },
      quickActions: { group: { mnemonic: 'g', label: 'Git' } },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.quickActions?.group?.mnemonic).toBe('g')
      expect(result.data.globalTab?.label).toBe('Git')
    }
  })

  it('accepts a command with a mnemonic and requires', () => {
    const result = ExtensionContributesSchema.safeParse({
      commands: [{ id: 'git:push', label: 'Push', mnemonic: 'p', requires: 'repo' }],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.commands?.[0]).toMatchObject({ mnemonic: 'p', requires: 'repo' })
    }
  })

  it('rejects a command mnemonic longer than one character', () => {
    const result = ExtensionContributesSchema.safeParse({
      commands: [{ id: 'git:push', label: 'Push', mnemonic: 'px' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid requires value', () => {
    const result = ExtensionContributesSchema.safeParse({
      commands: [{ id: 'git:push', label: 'Push', requires: 'workspace' }],
    })
    expect(result.success).toBe(false)
  })

  it('a command without mnemonic or requires still parses', () => {
    const result = ExtensionContributesSchema.safeParse({
      commands: [{ id: 'git:push', label: 'Push' }],
    })
    expect(result.success).toBe(true)
  })
})
