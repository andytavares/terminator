// What you can put in the model box.
//
// This used to be three `<option>` tags typed into the settings view, and by
// the time anyone looked they named a generation that had already shipped its
// successor. Worse, nothing read the setting: `defaultModel` was stored,
// rendered and never passed to `--model`, so choosing one changed nothing.
//
// Two sources, in the order they can be trusted:
//
//   1. The aliases. `--model opus` is documented as "an alias for the latest
//      model", so the runtime resolves it at launch and the list cannot go
//      stale by sitting here. This is always available, because it needs no
//      credential and no network.
//   2. The Models API, when the environment carries a key it can use. That is
//      the only published way to enumerate models — there is no CLI subcommand
//      that lists them — and it gives exact ids and display names for pinning
//      a run to one generation. Most operators are on a subscription login
//      rather than an API key, so this is an addition, never a requirement.

/** One row in the model picker. */
export interface ModelChoice {
  /** What goes on the `--model` command line. */
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
 * `inherit` first and empty-id on purpose: it means "don't pass `--model` at
 * all", so a run follows whatever the operator's own Claude Code configuration
 * says. That is the correct default for a console that is wrapping somebody
 * else's CLI, and it is what the pilot did — by accident — for its whole life
 * before the setting was wired up.
 */
export const MODEL_ALIASES: readonly ModelChoice[] = [
  { id: '', label: 'Use my Claude Code default', floating: true },
  { id: 'opus', label: 'Opus (latest)', floating: true },
  { id: 'sonnet', label: 'Sonnet (latest)', floating: true },
  { id: 'haiku', label: 'Haiku (latest)', floating: true },
  { id: 'fable', label: 'Fable (latest)', floating: true },
]

interface ModelsApiResponse {
  data?: Array<{ id?: unknown; display_name?: unknown }>
}

/**
 * The credential the Models API will accept, if the environment has one.
 *
 * Deliberately narrow: only the two variables the Anthropic SDKs read as a
 * bearer credential. A subscription login lives in the OS keychain under an
 * OAuth token that is not a Models API credential, and reaching for it would
 * be both fragile and a credential this extension has no business touching.
 */
function apiCredential(env: NodeJS.ProcessEnv): { header: string; value: string } | null {
  const token = env.ANTHROPIC_AUTH_TOKEN
  if (typeof token === 'string' && token.trim() !== '') {
    return { header: 'authorization', value: `Bearer ${token.trim()}` }
  }
  const key = env.ANTHROPIC_API_KEY
  if (typeof key === 'string' && key.trim() !== '') {
    return { header: 'x-api-key', value: key.trim() }
  }
  return null
}

/**
 * Every model the account can actually reach, newest first as the API returns
 * them.
 *
 * Returns an empty list rather than throwing on every failure path — no
 * credential, no network, a shape that changed. The aliases are a complete
 * working list on their own, so a settings page that cannot reach the API is
 * degraded, not broken, and must not surface an error for something the
 * operator never asked for.
 */
export async function fetchLiveModels(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<ModelChoice[]> {
  const credential = apiCredential(env)
  if (credential === null) return []

  try {
    const base = env.ANTHROPIC_BASE_URL?.replace(/\/+$/, '') ?? 'https://api.anthropic.com'
    const response = await fetchImpl(`${base}/v1/models?limit=100`, {
      headers: {
        [credential.header]: credential.value,
        'anthropic-version': '2023-06-01',
      },
    })
    if (!response.ok) return []
    const body = (await response.json()) as ModelsApiResponse
    if (!Array.isArray(body.data)) return []
    return body.data
      .filter(
        (model): model is { id: string; display_name?: unknown } =>
          typeof model.id === 'string' && model.id !== ''
      )
      .map((model) => ({
        id: model.id,
        label: typeof model.display_name === 'string' ? model.display_name : model.id,
        floating: false,
      }))
  } catch {
    return []
  }
}

/**
 * The picker's contents: aliases first, then whatever is pinnable.
 *
 * Aliases lead because they are the answer for almost everyone — a pinned id
 * is for reproducing a run, not for doing the work — and because putting the
 * live list first would make the picker's contents depend on whether an
 * environment variable happened to be set.
 */
export async function modelCatalog(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<ModelChoice[]> {
  const live = await fetchLiveModels(env, fetchImpl)
  const aliases = new Set(MODEL_ALIASES.map((choice) => choice.id))
  return [...MODEL_ALIASES, ...live.filter((choice) => !aliases.has(choice.id))]
}
