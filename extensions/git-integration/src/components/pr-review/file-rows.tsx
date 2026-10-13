import React from 'react'
import { Check, Dot, Plus } from 'lucide-react'
import type { Chapter, PrChangedFile } from '../../schemas/pr-review.schema'

/** What a file row shows beside its name: viewed, changed since the last look, new, or nothing. */
export type RowState = 'viewed' | 'changed' | 'new' | 'default'

/** The files the reviewer has viewed, and those that changed or appeared since they last looked. */
export interface SinceSets {
  viewedFiles: Set<string>
  changedSince: Set<string>
  newSinceLook: Set<string>
}

export function rowState(file: PrChangedFile, sets: SinceSets): RowState {
  if (sets.changedSince.has(file.path)) return 'changed'
  if (sets.newSinceLook.has(file.path)) return 'new'
  if (sets.viewedFiles.has(file.path)) return 'viewed'
  return 'default'
}

/** The chapter's files in the reviewer's own order when they dragged one, else the chapter's. */
export function orderedFiles(
  chapter: Chapter,
  overrideOrder: string[] | undefined
): PrChangedFile[] {
  if (!overrideOrder) return chapter.files
  return overrideOrder
    .map((p) => chapter.files.find((f) => f.path === p))
    .filter((f): f is PrChangedFile => !!f)
}

/** The class names whose flag is set, after `base`. */
export function classNames(base: string, flags: Record<string, boolean>): string {
  return [base, ...Object.keys(flags).filter((name) => flags[name])].join(' ')
}

const STATE_ICON = { viewed: Check, changed: Dot, new: Plus } as const

const STATE_LABEL: Record<Exclude<RowState, 'default'>, string> = {
  viewed: 'viewed',
  changed: 'changed',
  new: 'new file',
}

/** The row's number, or its state's icon once it has one. */
export function RowStateMark(props: { state: RowState; num: number; numClass: string }) {
  const { state } = props
  if (state === 'default') return <span className={props.numClass}>{props.num}</span>
  const Icon = STATE_ICON[state]
  return (
    <span className="rc-frow-state">
      <Icon aria-hidden="true" />
    </span>
  )
}

export function RowStateLabel({ state }: { state: RowState }) {
  if (state === 'default') return null
  return <span className={`rc-frow-sub rc-frow-sub--${state}`}>{STATE_LABEL[state]}</span>
}

/** "true" for the row being shown, so assistive tech announces it as current. */
export function currentAttr(isActive: boolean): 'true' | undefined {
  if (isActive) return 'true'
  return undefined
}
