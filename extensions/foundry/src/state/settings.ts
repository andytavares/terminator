import type { ExtensionAPI } from '@terminator/extension-sdk'

import { ASK_MODELS, DEFAULT_ASK_MODEL } from '../forge/converge.js'
import type { AskModel } from '../forge/converge.js'
import type { Budgets, WriteBack } from '../order/schema.js'
import { budgetFromSetting } from '../order/budget-setting.js'

export const MODEL_SETTING_KEY = 'terminator.foundry.defaultModel'
export const ASK_MODEL_SETTING_KEY = 'terminator.foundry.askModel'

/**
 * Tools the operator has declared read-only, beyond the ones the policy knows.
 *
 * Never inferred. `mcp__server__get_thing` and `mcp__server__delete_thing` are
 * the same shape to anything reading names, so guessing from one would be
 * guessing about writes — and the whole point of the read-only policy is that
 * a review cannot change what it is reviewing.
 */
export function readOnlyTools(api: ExtensionAPI): string[] {
  const raw = api.settings?.get<string>('terminator.foundry.readOnlyTools') ?? ''
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/** The autonomy dial, read wherever it is needed rather than copied. */
export function autonomyFor(api: ExtensionAPI): 'escorted' | 'standard' | 'lights-out' {
  return (
    api.settings?.get<'escorted' | 'standard' | 'lights-out'>('terminator.foundry.autonomy') ??
    'standard'
  )
}

/** Whether the red team runs on the balanced tier. Off unless the operator asks. */
export function lighterRedTeam(api: ExtensionAPI): boolean {
  return api.settings.get<boolean>('terminator.foundry.lighterRedTeam') ?? false
}

export function askModel(api: ExtensionAPI): AskModel {
  const value = api.settings.get<string>(ASK_MODEL_SETTING_KEY)
  return ASK_MODELS.find((m) => m === value) ?? DEFAULT_ASK_MODEL
}

/**
 * The model every phase launches with.
 *
 * Empty string is a real answer, not a missing one: it means "pass no
 * `--model`", so the run follows the operator's own Claude Code configuration.
 * Only an unset setting falls through to the default.
 */

export function defaultModel(api: ExtensionAPI): string {
  const value = api.settings.get<string>(MODEL_SETTING_KEY)
  // An alias, not a pinned id: `--model opus` resolves to the latest of that
  // family, so this default cannot go a generation stale sitting here — which
  // is exactly what the pinned id it replaced did.
  return typeof value === 'string' ? value : 'opus'
}

/**
 * The model this role runs on.
 *
 * A role declares `modelTier: fast | deep`, and the settings panel has always
 * said the operator's choice applies "unless a role asks for something else" —
 * which was not true of anything, because nothing read the field. A `fast`
 * role now runs on the small model; `deep`, and a node with no role at all,
 * take the operator's choice.
 *
 * An alias again rather than a pinned id, for the same reason: `haiku`
 * follows the latest of that family.
 */
export function modelForTier(api: ExtensionAPI, tier: 'fast' | 'deep'): string {
  const chosen = defaultModel(api)
  // An empty choice means "pass no --model", and a role asking for the fast
  // tier must not override the operator's decision to configure it themselves.
  if (chosen === '') return ''
  return tier === 'fast' ? 'haiku' : chosen
}

/**
 * Shadow mode: record, do not interrupt. On by default and deliberately so — a
 * detector with a 20% false-positive rate produces alarm fatigue and gets turned
 * off, which is worse than not shipping it. Turn it off on the evidence of the
 * firings below, not on faith.
 */

export function stallShadowMode(api: ExtensionAPI): boolean {
  return api.settings.get<boolean>('terminator.foundry.stallShadowMode') ?? true
}

/** Which write-backs a new order starts with, from the operator's settings. */
export function defaultWriteBack(api: ExtensionAPI): WriteBack[] {
  const on = (key: string): boolean => api.settings?.get<boolean>(key) ?? true
  const enabled: WriteBack[] = []
  if (on('terminator.foundry.writeBack.summaryComment')) enabled.push('summary_comment')
  if (on('terminator.foundry.writeBack.status')) enabled.push('status')
  if (on('terminator.foundry.writeBack.prLink')) enabled.push('pr_link')
  return enabled
}

/**
 * The budgets a new order starts with, from settings (FR-030).
 *
 * Read at seed time rather than at run time: the order carries its own agreed
 * budgets, and changing the setting later must not silently re-price work the
 * operator already agreed to.
 */
export function defaultBudgets(api: ExtensionAPI): Omit<Budgets, 'tokens'> {
  const num = (key: string, fallback: number): number | null =>
    budgetFromSetting(api.settings?.get<number>(key), fallback)
  return {
    agents: num('terminator.foundry.budgets.agents', 3),
    wallClockMinutes: num('terminator.foundry.budgets.wallClockMinutes', 45),
  }
}

/** The operator's critical paths, one glob per line (FR-043). Never inferred. */
export function declaredCriticalPaths(api: ExtensionAPI): string[] {
  const raw = api.settings?.get<string>('terminator.foundry.criticalPaths') ?? ''
  return [
    ...new Set(
      raw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
    ),
  ]
}
