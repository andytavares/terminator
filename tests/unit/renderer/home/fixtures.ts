import type { Sourced, ThreadFacet } from '../../../../src/shared/schemas/home-feed.schema'

/** A pull-request facet with every field present, for specs to vary one at a time. */
export function facet(patch: Partial<ThreadFacet> = {}): Sourced<ThreadFacet> {
  return {
    source: 'git-integration',
    workKey: { repoRoot: '/repos/terminator', branch: 'tav-31' },
    kind: 'pull-request',
    stage: 'in-review',
    whoseMove: 'others',
    line: 'Awaiting review',
    tone: 'waiting',
    closedAt: null,
    updatedAt: '2026-10-18T09:00:00.000Z',
    ...patch,
  }
}
