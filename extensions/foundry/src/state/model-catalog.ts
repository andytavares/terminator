import type { AgentsAPI } from '@terminator/extension-sdk'

// What you can put in the model box.
//
// This used to be three `<option>` tags typed into the settings view, and by
// the time anyone looked they named a generation that had already shipped its
// successor. Worse, nothing read the setting: `defaultModel` was stored,
// rendered and never passed to `--model`, so choosing one changed nothing.
//
// Two sources, in the order they can be trusted:
//
//   1. The aliases. `opus` is documented as "an alias for the latest model", so
//      the runtime resolves it at launch and the list cannot go stale by
//      sitting here. Always available: it needs no agent and no network.
//   2. The `model` option of the Claude agent (`api.agents.models('claude')`),
//      which gives exact ids and display names for pinning a run to one
//      generation. An addition, never a requirement.

/** One row in the model picker. */
export interface ModelChoice {
  /** What the agent is given as its model. */
  readonly id: string
  readonly label: string
  /**
   * True for the alias rows, which never go stale.
   *
   * Surfaced so the picker can say why an alias is the better default rather
   * than leaving it looking like a vaguer version of the pinned id below it.
   */
  readonly floating: boolean
}

/**
 * The aliases, which are the whole list when there is no API key.
 *
 * `inherit` first and empty-id on purpose: it means "pass no model at
 * all", so a run follows whatever the operator's own Claude Code configuration
 * says. That is the correct default for a console that is wrapping somebody
 * else's CLI, and it is what the pilot did — by accident — for its whole life
 * before the setting was wired up.
 * @internal
 */
export const MODEL_ALIASES: readonly ModelChoice[] = [
  { id: '', label: 'Use my Claude Code default', floating: true },
  { id: 'opus', label: 'Opus (latest)', floating: true },
  { id: 'sonnet', label: 'Sonnet (latest)', floating: true },
  { id: 'haiku', label: 'Haiku (latest)', floating: true },
  { id: 'fable', label: 'Fable (latest)', floating: true },
]

/**
 * Every model the Claude agent offers.
 *
 * Returns an empty list rather than throwing when the agent cannot say: the
 * aliases are a complete working list on their own, so a settings page that
 * cannot reach the agent is degraded, not broken.
 */
async function offeredModels(agents: Pick<AgentsAPI, 'models'>): Promise<ModelChoice[]> {
  try {
    const option = await agents.models('claude')
    return (option?.options ?? [])
      .filter((model) => model.value !== '')
      .map((model) => ({ id: model.value, label: model.name, floating: false }))
  } catch {
    return []
  }
}

/**
 * The picker's contents: aliases first, then whatever is pinnable.
 *
 * Aliases lead because they are the answer for almost everyone — a pinned id
 * is for reproducing a run, not for doing the work — and because putting the
 * live list first would make the picker's contents depend on whether the
 * agent could be asked.
 */
export async function modelCatalog(agents: Pick<AgentsAPI, 'models'>): Promise<ModelChoice[]> {
  const live = await offeredModels(agents)
  const aliases = new Set(MODEL_ALIASES.map((choice) => choice.id))
  return [...MODEL_ALIASES, ...live.filter((choice) => !aliases.has(choice.id))]
}
