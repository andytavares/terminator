import React, { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTaskStore } from '../../stores/task.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useSessionStore } from '../../stores/session.store'
import { agentStateOf } from '../../sidebar/agent-state'
import { laneSwitchOf } from '../../sidebar/task-groups'
import { revealBranch } from '../../terminal/reveal-branch'
import { StateGlyph } from '../home/StateGlyph'
import { recordUse } from '../../usage/record'
import './LaneSwitcher.css'

/** The branches with a terminal that is asking, so a lane can say so without being on screen. */
function useAskingBranches(): Set<string> {
  const sessions = useSessionStore((s) => s.sessions)
  return useMemo(
    () =>
      new Set(
        [...sessions.values()]
          .filter((s) => agentStateOf(s) === 'awaiting-input')
          .map((s) => s.projectId)
      ),
    [sessions]
  )
}

/** The Window → Switch Lane key for lane `i` (from 0): Ctrl on a Mac, Alt elsewhere. */
function laneKeyHint(i: number): string | undefined {
  if (i >= 9) return undefined
  return `${navigator.platform.startsWith('Mac') ? '⌃' : 'Alt+'}${i + 1}`
}

function switchLane(projectId: string): void {
  recordUse('core.terminal.switch-lane')
  revealBranch(projectId)
}

/** The task's name and a button per repo it spans, when the visible branch is in such a task. */
export function LaneSwitcher({ projectId }: { projectId: string }): JSX.Element | null {
  const tasks = useTaskStore((s) => s.tasks)
  const { workspaces, projects } = useWorkspaceStore(
    useShallow((s) => ({ workspaces: s.workspaces, projects: s.projectsByWorkspaceId }))
  )
  const asking = useAskingBranches()
  const switcher = laneSwitchOf(projectId, tasks, { workspaces, projects })
  if (switcher === null) return null
  return (
    <div className="lane-switcher" role="group" aria-label={`Lanes of ${switcher.title}`}>
      <span className="lane-switcher__title">{switcher.title}</span>
      {switcher.lanes.map((lane, i) => (
        <button
          key={lane.key}
          type="button"
          className={`lane-switcher__lane${i === switcher.current ? ' lane-switcher__lane--on' : ''}`}
          aria-pressed={i === switcher.current}
          title={laneKeyHint(i)}
          disabled={lane.projectId === null}
          onClick={() => lane.projectId !== null && switchLane(lane.projectId)}
        >
          {lane.label}
          {lane.projectId !== null && asking.has(lane.projectId) && (
            <StateGlyph state="needs-you" />
          )}
        </button>
      ))}
    </div>
  )
}
