import { basename } from 'path'
import type { SupervisedSession } from '../../../shared/types/supervision.js'
import type { WorkItemContract } from '../workitems/contract-schema.js'

// The unified index behind the palette (FR-026). One list over sessions, work
// items, repositories, worktrees and commands.
//
// The PRD's own check on the design: the palette is this query with a text box
// on it, so if the palette is hard to build the substrate is wrong. Building it
// took one function over data the registry already holds.

export type EntityKind = 'session' | 'workItem' | 'repository' | 'worktree' | 'command'

export interface IndexedEntity {
  readonly id: string
  readonly kind: EntityKind
  readonly label: string
  readonly detail?: string
}

export interface IndexInput {
  readonly sessions: readonly SupervisedSession[]
  readonly workItems: readonly WorkItemContract[]
  readonly commands: ReadonlyArray<{ id: string; label: string }>
}

export function buildEntityIndex(input: IndexInput): IndexedEntity[] {
  const entities: IndexedEntity[] = []
  const repositories = new Set<string>()

  for (const session of input.sessions) {
    entities.push({
      id: session.id,
      kind: 'session',
      label: session.branch,
      detail: `${session.repoPath.split('/').pop()} · ${session.runtimeState}`,
    })
    // A worktree is findable in its own right: opening one in an editor is a
    // first-class action, and it has a path the branch name does not give you.
    entities.push({
      id: session.worktreePath,
      kind: 'worktree',
      label: basename(session.worktreePath),
      detail: session.worktreePath,
    })
    repositories.add(session.repoPath)
  }

  for (const item of input.workItems) {
    entities.push({ id: item.id, kind: 'workItem', label: item.id, detail: item.title })
    for (const lane of item.lanes) repositories.add(lane.repo)
  }

  for (const repoPath of repositories) {
    entities.push({
      id: repoPath,
      kind: 'repository',
      label: basename(repoPath),
      detail: repoPath,
    })
  }

  for (const command of input.commands) {
    entities.push({ id: command.id, kind: 'command', label: command.label })
  }

  return entities
}
