import type { SessionFacts } from './session-facts'

/** Ticket titles known so far, keyed `tracker:key`. */
export type IssueTitles = ReadonlyMap<string, string>

/**
 * Whether a session matches what the operator typed.
 *
 * Covers every name the operator might remember a session by, including a
 * closed one's description — finding that again is the reason it was kept.
 */
export function matchesFilter(facts: SessionFacts, text: string, titles: IssueTitles): boolean {
  const needle = text.trim().toLowerCase()
  if (needle === '') return true
  const ref = facts.workItem?.ref
  const haystack = [
    facts.name,
    facts.workspaceName,
    facts.projectName,
    facts.branch,
    ref?.key,
    ref ? titles.get(`${ref.tracker}:${ref.key}`) : undefined,
    facts.description,
  ]
  return haystack.some((field) => field?.toLowerCase().includes(needle) === true)
}
