import React from 'react'
import { Circle, CircleCheck, MessageSquare } from 'lucide-react'
import type { Chapter, PrChangedFile } from '../../schemas/pr-review.schema'
import type { PrReviewStore } from '../../stores/pr-review.store'
import { choose, splitPath } from '../text'
import './file-tree.css'

/** Whether a file is viewed, changed since the last look, new, or nothing of those. */
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

/** Makes `chapterId` current and opens its first file, in the reviewer's order. */
export function startAtChapter(
  store: Pick<PrReviewStore, 'setCurrentChapter' | 'setCurrentFile' | 'fileOrderOverrides'>,
  chapters: Chapter[],
  chapterId: string
): void {
  store.setCurrentChapter(chapterId)
  const chapter = chapters.find((c) => c.id === chapterId)
  if (chapter) {
    store.setCurrentFile(
      orderedFiles(chapter, store.fileOrderOverrides[chapter.id])[0]?.path ?? null
    )
  }
}

/** The class names whose flag is set, after `base`. */
export function classNames(base: string, flags: Record<string, boolean>): string {
  return [base, ...Object.keys(flags).filter((name) => flags[name])].join(' ')
}

const STATE_LABEL = { changed: 'changed', new: 'new file' } as const

/** The row's viewed / unviewed / high-risk glyph; its label is the state for assistive tech. */
function RowGlyph(props: { isViewed: boolean; isHighRisk: boolean }) {
  if (props.isViewed) {
    return (
      <span className="file-tree-glyph file-tree-glyph--done" role="img" aria-label="Viewed">
        <CircleCheck aria-hidden="true" />
      </span>
    )
  }
  const label = choose(props.isHighRisk, 'High risk, not viewed', 'Not viewed')
  const tone = choose(props.isHighRisk, 'risk', 'todo')
  return (
    <span className={`file-tree-glyph file-tree-glyph--${tone}`} role="img" aria-label={label}>
      <Circle aria-hidden="true" />
    </span>
  )
}

function RowSinceLabel({ state }: { state: RowState }) {
  if (state !== 'changed' && state !== 'new') return null
  return <span className={`file-tree-since file-tree-since--${state}`}>{STATE_LABEL[state]}</span>
}

interface FileRowContentProps {
  file: PrChangedFile
  state: RowState
  isViewed: boolean
  threadCount: number
}

/** What every file row shows: state glyph, name and folder, since-label, comment count, additions. */
export function FileRowContent(props: FileRowContentProps) {
  const { file, threadCount } = props
  const { dir, name } = splitPath(file.path)
  const isHighRisk = file.riskScore.level === 'high'
  return (
    <>
      <RowGlyph isViewed={props.isViewed} isHighRisk={isHighRisk} />
      <span className="file-tree-name">
        <b>{name}</b>
        {dir && <small> {dir}</small>}
      </span>
      <span className="file-tree-end">
        <RowSinceLabel state={props.state} />
        {threadCount > 0 && (
          <span className="file-tree-comments">
            <MessageSquare aria-hidden="true" />
            {threadCount}
          </span>
        )}
        <span className="file-tree-add">+{file.additions}</span>
      </span>
    </>
  )
}

/** "true" for the row being shown, so assistive tech announces it as current. */
export function currentAttr(isActive: boolean): 'true' | undefined {
  if (isActive) return 'true'
  return undefined
}
