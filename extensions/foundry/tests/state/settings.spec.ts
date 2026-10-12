import { describe, it, expect } from 'vitest'
import type { ExtensionAPI } from '@terminator/extension-sdk'

import {
  readOnlyTools,
  autonomyFor,
  lighterRedTeam,
  askModel,
  defaultModel,
  modelForTier,
  stallShadowMode,
  defaultWriteBack,
  defaultBudgets,
  declaredCriticalPaths,
} from '../../src/state/settings.js'
import { DEFAULT_ASK_MODEL } from '../../src/forge/converge.js'

// What the operator wrote in the settings page, as each reader hands it on.

function host(values: Record<string, unknown> = {}): ExtensionAPI {
  return { settings: { get: (key: string) => values[key] } } as unknown as ExtensionAPI
}

describe('settings the operator never touched', () => {
  const nothing = host()

  it('run at standard autonomy, on opus, with the stall detector in shadow mode', () => {
    expect(autonomyFor(nothing)).toBe('standard')
    expect(defaultModel(nothing)).toBe('opus')
    expect(stallShadowMode(nothing)).toBe(true)
    expect(lighterRedTeam(nothing)).toBe(false)
    expect(askModel(nothing)).toBe(DEFAULT_ASK_MODEL)
  })

  it('start a new order with every write-back on and the documented budgets', () => {
    expect(defaultWriteBack(nothing)).toEqual(['summary_comment', 'status', 'pr_link'])
    expect(defaultBudgets(nothing)).toEqual({ agents: 3, wallClockMinutes: 45 })
  })

  it('declare no read-only tools and no critical paths', () => {
    expect(readOnlyTools(nothing)).toEqual([])
    expect(declaredCriticalPaths(nothing)).toEqual([])
  })
})

describe('the model a run launches with', () => {
  it('is no --model at all when the operator cleared the box, for every tier', () => {
    const cleared = host({ 'terminator.foundry.defaultModel': '' })
    expect(defaultModel(cleared)).toBe('')
    expect(modelForTier(cleared, 'fast')).toBe('')
    expect(modelForTier(cleared, 'deep')).toBe('')
  })

  it('is the small model for a fast role and the chosen one for a deep role', () => {
    const chosen = host({ 'terminator.foundry.defaultModel': 'sonnet' })
    expect(modelForTier(chosen, 'fast')).toBe('haiku')
    expect(modelForTier(chosen, 'deep')).toBe('sonnet')
  })

  it('answers an ask with the default when the setting names a model that is not offered', () => {
    expect(askModel(host({ 'terminator.foundry.askModel': 'gpt-4' }))).toBe(DEFAULT_ASK_MODEL)
  })
})

describe('lists written one per line', () => {
  it('ignore blank lines and surrounding space, and name a critical path once', () => {
    const written = host({
      'terminator.foundry.readOnlyTools': '  mcp__docs__get \n\n mcp__docs__search',
      'terminator.foundry.criticalPaths': 'src/auth/**\n\nsrc/auth/**\n  migrations/** ',
    })
    expect(readOnlyTools(written)).toEqual(['mcp__docs__get', 'mcp__docs__search'])
    expect(declaredCriticalPaths(written)).toEqual(['src/auth/**', 'migrations/**'])
  })
})

describe('a new order', () => {
  it('leaves out each write-back the operator turned off', () => {
    const off = host({
      'terminator.foundry.writeBack.summaryComment': false,
      'terminator.foundry.writeBack.prLink': false,
    })
    expect(defaultWriteBack(off)).toEqual(['status'])
  })

  it('takes the budgets the operator set', () => {
    const set = host({
      'terminator.foundry.budgets.agents': 5,
      'terminator.foundry.budgets.wallClockMinutes': 90,
    })
    expect(defaultBudgets(set)).toEqual({ agents: 5, wallClockMinutes: 90 })
  })
})
