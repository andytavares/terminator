import React from 'react'
import './desk.css'

export type WorkStage = 'shaping' | 'building' | 'in-review' | 'merging' | 'shipped'

export const WORK_STAGES: readonly { stage: WorkStage; name: string }[] = [
  { stage: 'shaping', name: 'Shaping' },
  { stage: 'building', name: 'Building' },
  { stage: 'in-review', name: 'In review' },
  { stage: 'merging', name: 'Merging' },
  { stage: 'shipped', name: 'Shipped' },
]

export interface StageBarProps {
  /** Where the work is now; earlier stages show as done. */
  stage: WorkStage
  /** The current stage is waiting on the reader, so it shows in the waiting colour. */
  yourMove?: boolean
  /** `compact` is a thin bar, with `caption` under it; `large` names every stage under its segment. */
  size?: 'compact' | 'large'
  /** A line under the compact bar: "Waiting on your review". */
  caption?: string
}

type SegmentState = 'done' | 'current' | 'upcoming'

function segmentState(index: number, currentIndex: number): SegmentState {
  if (index < currentIndex) return 'done'
  return index === currentIndex ? 'current' : 'upcoming'
}

function StageSegment({ name, state }: { name: string; state: SegmentState }): JSX.Element {
  return (
    <li
      className="tmui-stage-bar__segment"
      data-state={state}
      aria-current={state === 'current' ? 'step' : undefined}
    >
      <i aria-hidden="true" />
      <span className="tmui-stage-bar__name">{name}</span>
    </li>
  )
}

/** The five stages of a piece of work as a segmented bar. */
export function StageBar({
  stage,
  yourMove = false,
  size = 'compact',
  caption,
}: StageBarProps): JSX.Element {
  const currentIndex = WORK_STAGES.findIndex((entry) => entry.stage === stage)
  const classes = [
    'tmui-stage-bar',
    `tmui-stage-bar--${size}`,
    yourMove && 'tmui-stage-bar--your-move',
  ]
  return (
    <div>
      <ol aria-label="Stage" className={classes.filter(Boolean).join(' ')}>
        {WORK_STAGES.map((entry, index) => (
          <StageSegment
            key={entry.stage}
            name={entry.name}
            state={segmentState(index, currentIndex)}
          />
        ))}
      </ol>
      {caption && size === 'compact' ? <div className="tmui-stage-caption">{caption}</div> : null}
    </div>
  )
}
