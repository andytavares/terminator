import type { Sourced, ThreadFacet } from '../../../../src/shared/schemas/home-feed.schema'
import type { Task } from '../../../../src/shared/schemas/tasks.schema'

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

/** A stored task with every field present, for specs to vary one at a time. */
export function task(patch: Partial<Task> = {}): Task {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Rate limits',
    lanes: [],
    ticket: null,
    focus: false,
    doneAt: null,
    createdAt: '2026-10-18T08:00:00.000Z',
    archivedAt: null,
    ...patch,
  }
}
