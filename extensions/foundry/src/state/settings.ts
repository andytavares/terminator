import type { ExtensionAPI } from '@terminator/extension-sdk'

import { ASK_MODELS, DEFAULT_ASK_MODEL } from '../forge/converge.js'
import type { AskModel } from '../forge/converge.js'
import type { Budgets, WriteBack } from '../order/schema.js'
import { budgetFromSetting } from '../order/budget-setting.js'

export const MODEL_SETTING_KEY = 'terminator.foundry.defaultModel'
export const ASK_MODEL_SETTING_KEY = 'terminator.foundry.askModel'

// Tools the operator declared read-only beyond those the policy knows, never inferred:
// `mcp__server__get_thing` and `mcp__server__delete_thing` look alike to a reader.
export function readOnlyTools(api: ExtensionAPI, repoPath: string): string[] {
  return api.settings?.get<string[]>('terminator.foundry.readOnlyTools', { repoPath }) ?? []
}

const LINE_LIST_SETTINGS = ['terminator.foundry.readOnlyTools', 'terminator.foundry.criticalPaths']

// Both lists were one-item-per-line text settings before the list type existed; a
// value stored that way becomes the list it spelled.
export function migrateLineListSettings(api: ExtensionAPI): void {
  for (const key of LINE_LIST_SETTINGS) {
    const stored = api.settings.get<unknown>(key)
    if (typeof stored !== 'string') continue
    const items = stored.split('\n').map((line) => line.trim())
    api.settings.set(
      key,
      items.filter((line) => line !== '')
    )
  }
}

/** The autonomy dial, read wherever it is needed rather than copied. */
export function autonomyFor(api: ExtensionAPI): 'escorted' | 'standard' | 'lights-out' {
  return (
    api.settings?.get<'escorted' | 'standard' | 'lights-out'>('terminator.foundry.autonomy') ??
    'standard'
  )
}

/** Whether a tool call Foundry's rules leave undecided goes to Claude Code's auto mode. On unless turned off. */
export function letAutoModeDecide(api: ExtensionAPI): boolean {
  return api.settings?.get<boolean>('terminator.foundry.letAutoModeDecide') ?? true
}

/** Whether the red team runs on the balanced tier. Off unless the operator asks. */
export function lighterRedTeam(api: ExtensionAPI): boolean {
  return api.settings.get<boolean>('terminator.foundry.lighterRedTeam') ?? false
}

export function askModel(api: ExtensionAPI): AskModel {
  const value = api.settings.get<string>(ASK_MODEL_SETTING_KEY)
  return ASK_MODELS.find((m) => m === value) ?? DEFAULT_ASK_MODEL
}

// The model every phase launches with. An empty string means "pass no `--model`" and
// follows the operator's Claude Code configuration; only an unset one takes the default.
export function defaultModel(api: ExtensionAPI): string {
  const value = api.settings.get<string>(MODEL_SETTING_KEY)
  // An alias, not a pinned id: `--model opus` resolves to the latest of that
  // family, so this default cannot go a generation stale sitting here — which
  // is exactly what the pinned id it replaced did.
  return typeof value === 'string' ? value : 'opus'
}

// The model a role runs on: `modelTier: fast` takes the small model (an alias, so the
// latest of its family); `deep`, or no role, takes the operator's choice, as the
// settings panel says.
export function modelForTier(api: ExtensionAPI, tier: 'fast' | 'deep'): string {
  const chosen = defaultModel(api)
  // An empty choice means "pass no --model", and a role asking for the fast
  // tier must not override the operator's decision to configure it themselves.
  if (chosen === '') return ''
  return tier === 'fast' ? 'haiku' : chosen
}

// Shadow mode, on by default: record, do not interrupt. A noisy detector gets turned
// off; turn this off on the evidence of the firings, not on faith.
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

// A new order's budgets from settings (FR-030), read at seed time: the order carries
// what was agreed, and a later setting must not re-price it.
export function defaultBudgets(api: ExtensionAPI): Omit<Budgets, 'tokens'> {
  const num = (key: string, fallback: number): number | null =>
    budgetFromSetting(api.settings?.get<number>(key), fallback)
  return {
    agents: num('terminator.foundry.budgets.agents', 3),
    wallClockMinutes: num('terminator.foundry.budgets.wallClockMinutes', 45),
  }
}

// The operator's critical paths, one glob per line (FR-043), for every repository's
// workspace; never inferred.
export function declaredCriticalPaths(api: ExtensionAPI, repoPaths: readonly string[]): string[] {
  const listFor = (repoPath: string) =>
    api.settings?.get<string[]>('terminator.foundry.criticalPaths', { repoPath }) ?? []
  return [...new Set(repoPaths.flatMap(listFor))]
}
