import React from 'react'
import { TASK_STATES, type TaskState } from '../../home/task-state'
import { useDeskFilter } from './desk-filter'
import { StateGlyph } from './StateGlyph'
import type { DeskState } from './useDeskModel'

const WORDS: Record<TaskState, string> = {
  'needs-you': 'need you',
  running: 'running',
  waiting: 'waiting on others',
  quiet: 'quiet',
  done: 'done',
}

/** The queue counts what is asking; every other state counts the open tasks in it. */
function pulseCounts(desk: Pick<DeskState, 'asks' | 'threads'>): Record<TaskState, number> {
  const live = desk.threads.filter((thread) => !thread.archived)
  const counts = Object.fromEntries(
    TASK_STATES.map((state) => [state, live.filter((t) => t.state === state).length])
  ) as Record<TaskState, number>
  return { ...counts, 'needs-you': desk.asks.length }
}

/** The five states as counts, the empty ones left out; each count narrows Home to its state. */
export function PulseLine({
  desk,
}: {
  desk: Pick<DeskState, 'asks' | 'threads'>
}): React.JSX.Element {
  const pressed = useDeskFilter((s) => s.taskState)
  const setTaskState = useDeskFilter((s) => s.setTaskState)
  const counts = pulseCounts(desk)
  return (
    <div className="pulse" role="group" aria-label="Task states">
      {TASK_STATES.filter((state) => counts[state] > 0).map((state) => (
        <button
          key={state}
          type="button"
          className="pulse__count"
          aria-pressed={pressed === state}
          onClick={() => setTaskState(pressed === state ? null : state)}
        >
          <span aria-hidden="true" className="pulse__glyph">
            <StateGlyph state={state} />
          </span>
          <b>{counts[state]}</b> {WORDS[state]}
        </button>
      ))}
    </div>
  )
}
