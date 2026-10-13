import { describe, it, expect } from 'vitest'
import type { ExtensionAPI, SettingScope } from '@terminator/extension-sdk'

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
  migrateLineListSettings,
} from '../../src/state/settings.js'
import { DEFAULT_ASK_MODEL } from '../../src/forge/converge.js'
import { partialFake } from '../../../../tests/support/fakes'

// What the operator wrote in the settings page, as each reader hands it on.

function host(values: Record<string, unknown> = {}): ExtensionAPI {
  const settings = partialFake<ExtensionAPI['settings']>({
    get: <T>(key: string) => values[key] as T,
  })
  return partialFake<ExtensionAPI>({ settings })
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
    expect(readOnlyTools(nothing, '/code/api')).toEqual([])
    expect(declaredCriticalPaths(nothing, ['/code/api'])).toEqual([])
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

describe('lists the operator wrote, one item per line', () => {
  it('are read as written, and name a critical path once', () => {
    const written = host({
      'terminator.foundry.readOnlyTools': ['mcp__docs__get', 'mcp__docs__search'],
      'terminator.foundry.criticalPaths': ['src/auth/**', 'src/auth/**', 'migrations/**'],
    })
    expect(readOnlyTools(written, '/code/api')).toEqual(['mcp__docs__get', 'mcp__docs__search'])
    expect(declaredCriticalPaths(written, ['/code/api'])).toEqual(['src/auth/**', 'migrations/**'])
  })
})

// Both lists are workspace-scoped: the core answers the own value of the
// workspace holding the repository, else the global one.
const READ_ONLY = 'terminator.foundry.readOnlyTools'
const CRITICAL = 'terminator.foundry.criticalPaths'

/** Settings as the core resolves them, with `own` values by workspace folder. */
function scoped(
  global: Record<string, unknown>,
  own: Record<string, Record<string, unknown>>
): ExtensionAPI {
  const ownFor = (repoPath?: string) =>
    Object.entries(own).find(([folder]) => repoPath?.startsWith(folder))?.[1]
  const settings = partialFake<ExtensionAPI['settings']>({
    get: <T>(key: string, scope?: SettingScope) =>
      (ownFor(scope?.repoPath)?.[key] ?? global[key]) as T,
  })
  return partialFake<ExtensionAPI>({ settings })
}

describe("the lists for an order's repositories", () => {
  it("reads the read-only tools of the repository's workspace, else the global list", () => {
    const api = scoped(
      { [READ_ONLY]: ['mcp__docs__get'] },
      { '/code/api': { [READ_ONLY]: ['mcp__api__read'] } }
    )
    expect(readOnlyTools(api, '/code/api')).toEqual(['mcp__api__read'])
    expect(readOnlyTools(api, '/code/web')).toEqual(['mcp__docs__get'])
  })

  it("gathers the critical paths of every repository's workspace, each once", () => {
    const api = scoped(
      { [CRITICAL]: ['migrations/**'] },
      { '/code/api': { [CRITICAL]: ['src/auth/**', 'migrations/**'] } }
    )
    expect(declaredCriticalPaths(api, ['/code/api', '/code/web'])).toEqual([
      'src/auth/**',
      'migrations/**',
    ])
    expect(declaredCriticalPaths(api, ['/code/web'])).toEqual(['migrations/**'])
  })
})

describe('a list an earlier version stored as text', () => {
  /** Settings the migration reads and writes, held in `values`. */
  function storedIn(values: Record<string, unknown>): ExtensionAPI {
    const settings = partialFake<ExtensionAPI['settings']>({
      get: <T>(key: string) => values[key] as T,
      set: (key: string, value: unknown) => void (values[key] = value),
    })
    return partialFake<ExtensionAPI>({ settings })
  }

  it('becomes one item per line, without blank lines or surrounding space', () => {
    const values: Record<string, unknown> = {
      'terminator.foundry.readOnlyTools': '  mcp__docs__get \n\n mcp__docs__search',
      'terminator.foundry.criticalPaths': ['src/auth/**'],
    }
    migrateLineListSettings(storedIn(values))
    expect(values).toEqual({
      'terminator.foundry.readOnlyTools': ['mcp__docs__get', 'mcp__docs__search'],
      'terminator.foundry.criticalPaths': ['src/auth/**'],
    })
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
