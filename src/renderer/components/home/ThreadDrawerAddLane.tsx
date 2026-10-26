import React, { useState } from 'react'
import { Button } from '@terminator/extension-ui'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { addLanesToTask, useLaneCards, type LaneCard } from '../tasks/add-to-task-model'
import { addRepoToTask } from './task-actions'
import type { WorkThread } from '../../home/work-threads'
import type { Workspace } from '../../../shared/types/index'

type Offer = 'repo' | 'branch' | null

/** "+ Add a repo" and "Add a branch I already have…" under a stored task's lanes. */
export function AddLaneControls({ thread }: { thread: WorkThread }): JSX.Element | null {
  const [offer, setOffer] = useState<Offer>(null)
  const [error, setError] = useState<string | null>(null)
  if (thread.taskId === null) return null
  const taskId = thread.taskId
  const inTask = new Set(thread.lanes.map((l) => l.repoRoot))
  const done = (message: string | null): void => (
    setError(message), setOffer(message === null ? null : offer)
  )
  return (
    <div className="task-add-lane">
      <Button size="sm" variant="ghost" onClick={() => setOffer(offer === 'repo' ? null : 'repo')}>
        + Add a repo
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOffer(offer === 'branch' ? null : 'branch')}
      >
        Add a branch I already have…
      </Button>
      {offer === 'repo' && (
        <RepoOffer {...{ taskId, inTask, onDone: done }} branch={thread.lanes[0]?.branch ?? ''} />
      )}
      {offer === 'branch' && <BranchOffer {...{ taskId, inTask, onDone: done }} />}
      {error !== null && <p role="alert">{error}</p>}
    </div>
  )
}

interface OfferProps {
  taskId: string
  inTask: ReadonlySet<string>
  onDone: (message: string | null) => void
}

/** The repos the task is not in; choosing one starts the task's branch there. */
function RepoOffer({ taskId, inTask, branch, onDone }: OfferProps & { branch: string }) {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const add = async (workspace: Workspace): Promise<void> =>
    onDone(await addRepoToTask(taskId, branch, workspace))
  return (
    <div className="task-add-lane__choices" role="group" aria-label="Repos not in this task">
      {workspaces
        .filter((w) => !inTask.has(w.folderPath))
        .map((workspace) => (
          <Button key={workspace.id} size="sm" onClick={() => void add(workspace)}>
            {workspace.name}
          </Button>
        ))}
    </div>
  )
}

/** The branch cards of repos the task is not in; choosing one adds it as a lane. */
function BranchOffer({ taskId, inTask, onDone }: OfferProps): JSX.Element {
  const cards = useLaneCards().filter((c) => !inTask.has(c.lane.repoRoot))
  const add = async (card: LaneCard): Promise<void> =>
    onDone((await addLanesToTask(taskId, [card.lane])) ? null : 'The task could not be changed.')
  return (
    <div className="task-add-lane__choices" role="group" aria-label="Branches not in this task">
      {cards.length === 0 && <p>No other repo has a branch to add.</p>}
      {cards.map((card) => (
        <Button
          key={`${card.lane.repoRoot}#${card.lane.branch}`}
          size="sm"
          onClick={() => void add(card)}
        >
          {`${card.repoName} / ${card.lane.branch}`}
        </Button>
      ))}
    </div>
  )
}
