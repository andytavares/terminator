import React from 'react'
import { STATE_LABELS, type TaskState } from '../../home/task-state'
import './Tasks.css'

interface StateGlyphProps {
  state: TaskState
  /** The state is needs-you from a bell or a screen choice alone: drawn hollow and dashed. */
  inferred?: boolean
}

const STROKE = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' } as const

/** Needs you: a filled ring with an exclamation mark. */
const NEEDS_YOU = (
  <>
    <circle cx="8" cy="8" r="7" fill="currentColor" opacity=".18" />
    <circle cx="8" cy="8" r="7" {...STROKE} strokeWidth="1.4" />
    <path d="M8 4.2v4.4" {...STROKE} strokeWidth="1.7" />
    <circle cx="8" cy="11.3" r="1" fill="currentColor" />
  </>
)

/** Needs you, inferred: the same mark inside a dashed, unfilled ring. */
const NEEDS_YOU_INFERRED = (
  <>
    <circle cx="8" cy="8" r="6.6" {...STROKE} strokeWidth="1.3" strokeDasharray="2.2 1.6" />
    <path d="M8 4.6v4" {...STROKE} strokeWidth="1.6" />
    <circle cx="8" cy="11.1" r="0.95" fill="currentColor" />
  </>
)

const SHAPES: Record<Exclude<TaskState, 'needs-you'>, JSX.Element> = {
  running: (
    <>
      <circle cx="8" cy="8" r="7" {...STROKE} strokeWidth="1.4" opacity=".35" />
      <path d="M8 1a7 7 0 0 1 7 7" {...STROKE} strokeWidth="1.6" />
      <path d="M6.5 5.4v5.2L10.6 8z" fill="currentColor" />
    </>
  ),
  waiting: (
    <>
      <circle cx="8" cy="8" r="7" {...STROKE} strokeWidth="1.4" />
      <path d="M8 4.5V8l2.4 1.6" {...STROKE} strokeWidth="1.5" />
    </>
  ),
  quiet: <circle cx="8" cy="8" r="6.3" {...STROKE} strokeWidth="1.4" strokeDasharray="2.4 2" />,
  done: (
    <>
      <circle cx="8" cy="8" r="7" fill="currentColor" opacity=".18" />
      <circle cx="8" cy="8" r="7" {...STROKE} strokeWidth="1.4" />
      <path d="M5 8.2l2 2 4-4.3" {...STROKE} strokeWidth="1.6" strokeLinejoin="round" />
    </>
  ),
}

function shapeOf(state: TaskState, inferred: boolean): JSX.Element {
  if (state !== 'needs-you') return SHAPES[state]
  return inferred ? NEEDS_YOU_INFERRED : NEEDS_YOU
}

/** A task's state as a glyph with its own shape, so the five read apart without colour. */
export function StateGlyph({ state, inferred = false }: StateGlyphProps): JSX.Element {
  const hollow = state === 'needs-you' && inferred
  return (
    <svg
      role="img"
      aria-label={hollow ? `${STATE_LABELS[state]}, inferred` : STATE_LABELS[state]}
      className={`state-glyph state-glyph--${state}`}
      viewBox="0 0 16 16"
    >
      {shapeOf(state, inferred)}
    </svg>
  )
}
