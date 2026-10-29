import { describe, it, expect } from 'vitest'
import { ExtensionContributesSchema } from '../../../../src/shared/schemas/extension.schema'

describe('ExtensionContributesSchema — quick actions', () => {
  it('accepts a quickActions group with a one-char mnemonic', () => {
    const result = ExtensionContributesSchema.parse({
      quickActions: { group: { mnemonic: 'g', label: 'Git' } },
    })
    expect(result.quickActions).toEqual({ group: { mnemonic: 'g', label: 'Git' } })
  })

  it('accepts a quickActions group without a mnemonic', () => {
    const result = ExtensionContributesSchema.safeParse({
      quickActions: { group: { label: 'Git' } },
    })
    expect(result.success).toBe(true)
  })
})

describe('ExtensionContributesSchema — quick action mnemonics and transform', () => {
  it('rejects a mnemonic longer than one character', () => {
    const result = ExtensionContributesSchema.safeParse({
      quickActions: { group: { mnemonic: 'gi', label: 'Git' } },
    })
    expect(result.success).toBe(false)
  })

  it('preserves quickActions through the transform alongside other keys', () => {
    const result = ExtensionContributesSchema.parse({
      globalTab: { label: 'Git' },
      quickActions: { group: { mnemonic: 'g', label: 'Git' } },
    })
    expect(result.quickActions?.group?.mnemonic).toBe('g')
    expect(result.globalTab?.label).toBe('Git')
  })
})

describe('ExtensionContributesSchema — command mnemonics and requires', () => {
  it('accepts a command with a mnemonic and requires', () => {
    const result = ExtensionContributesSchema.parse({
      commands: [{ id: 'git:push', label: 'Push', mnemonic: 'p', requires: 'repo' }],
    })
    expect(result.commands?.[0]).toMatchObject({ mnemonic: 'p', requires: 'repo' })
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

describe('ExtensionContributesSchema — Insights section', () => {
  it('keeps a insightsSection through the transform', () => {
    const result = ExtensionContributesSchema.parse({
      insightsSection: { label: 'Pull requests', view: 'prs' },
    })
    expect(result.insightsSection).toEqual({ label: 'Pull requests', view: 'prs' })
  })

  it('requires the label', () => {
    const result = ExtensionContributesSchema.safeParse({ insightsSection: { view: 'prs' } })
    expect(result.success).toBe(false)
  })
})

describe('ExtensionContributesSchema — usage', () => {
  it('keeps a usage item', () => {
    const result = ExtensionContributesSchema.parse({
      usage: [{ id: 'go-to-run', label: 'Go to run' }],
    })
    expect(result.usage).toEqual([{ id: 'go-to-run', label: 'Go to run' }])
  })

  it.each(['Go', '-go', 'go to', 'a'.repeat(61), ''])('rejects the usage id %j', (id) => {
    expect(ExtensionContributesSchema.safeParse({ usage: [{ id, label: 'x' }] }).success).toBe(
      false
    )
  })

  it('rejects an empty label', () => {
    expect(ExtensionContributesSchema.safeParse({ usage: [{ id: 'go', label: '' }] }).success).toBe(
      false
    )
  })
})
