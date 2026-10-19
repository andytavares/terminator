import type { HomeAsk, ThreadFacet } from '../../shared/schemas/home-feed.schema'

export interface SinceEvent {
  id: string
  kind:
    | 'agent-finished'
    | 'review-requested'
    | 'pull-request-approved'
    | 'pull-request-merged'
    | 'checks-failed'
  text: string
  at: number
}

function fromAsk(ask: HomeAsk): SinceEvent | null {
  const at = Date.parse(ask.since)
  if (ask.kind === 'finished') return { id: ask.id, kind: 'agent-finished', text: ask.detail, at }
  if (ask.kind === 'review') return { id: ask.id, kind: 'review-requested', text: ask.title, at }
  return null
}

function factKind(facet: ThreadFacet): SinceEvent['kind'] | null {
  if (facet.kind !== 'pull-request') return null
  if (facet.closedAt !== null) return facet.tone === 'good' ? 'pull-request-merged' : null
  if (facet.checks?.some((c) => c.state === 'failed')) return 'checks-failed'
  return facet.stage === 'merging' && facet.tone === 'good' ? 'pull-request-approved' : null
}

function fromFacet(facet: ThreadFacet): SinceEvent | null {
  const kind = factKind(facet)
  if (kind === null) return null
  const id = `${JSON.stringify(facet.workKey)}:${kind}`
  return { id, kind, text: facet.title ?? facet.line, at: Date.parse(facet.updatedAt) }
}

/** What happened after the operator last looked at Home, newest first. */
export function sinceYouLeft(
  asks: readonly HomeAsk[],
  facets: readonly ThreadFacet[],
  lastLeftHomeAt: number | null
): SinceEvent[] {
  if (lastLeftHomeAt === null) return []
  return [...asks.map(fromAsk), ...facets.map(fromFacet)]
    .filter((e): e is SinceEvent => e !== null && e.at > lastLeftHomeAt)
    .sort((a, b) => b.at - a.at)
}
