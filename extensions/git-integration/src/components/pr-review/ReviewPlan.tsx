import React, { useId } from 'react'
import { ArrowRight } from 'lucide-react'
import { plural } from '@terminator/extension-sdk'
import type { Chapter } from '../../schemas/pr-review.schema'
import { choose, splitPath } from '../text'
import './review-plan.css'
import './review-layout.css'

interface Props {
  chapters: Chapter[]
  onStartAt: (chapterId: string) => void
}

const SHOWN_FILE_NAMES = 3

function totalLines(chapter: Chapter): number {
  return chapter.files.reduce((sum, f) => sum + f.additions + f.deletions, 0)
}

function fileNamesOf(chapter: Chapter): string {
  const names = chapter.files.slice(0, SHOWN_FILE_NAMES).map((f) => splitPath(f.path).name)
  const hidden = chapter.files.length - SHOWN_FILE_NAMES
  return names.join(', ') + choose(hidden > 0, ` +${hidden}`, '')
}

function addedLines(chapter: Chapter): number {
  return chapter.files.reduce((sum, f) => sum + f.additions, 0)
}

/** "+120 −4": the lines a chapter adds and removes. */
function changedLinesText(chapter: Chapter): string {
  const added = addedLines(chapter)
  return `+${added} −${totalLines(chapter) - added}`
}

function ChangeBar({ chapter, largest }: { chapter: Chapter; largest: number }) {
  const added = addedLines(chapter)
  const removed = totalLines(chapter) - added
  return (
    <span className="review-plan__bar" aria-hidden="true">
      <b className="review-plan__bar-added" style={{ width: `${(added / largest) * 100}%` }} />
      <b className="review-plan__bar-removed" style={{ width: `${(removed / largest) * 100}%` }} />
    </span>
  )
}

function filesText(fileCount: number): string {
  return `${fileCount} ${plural(fileCount, 'file')}`
}

interface AccessibleTextProps {
  chapter: Chapter
  labelId: string
  descriptionId: string
}

/** What a screen reader hears for a row: its name, then the facts the sighted columns show. */
function RowAccessibleText({ chapter, labelId, descriptionId }: AccessibleTextProps) {
  return (
    <>
      <span id={labelId} className="pr-visually-hidden">
        Start here: {chapter.name}
      </span>
      <span id={descriptionId} className="pr-visually-hidden">
        {filesText(chapter.files.length)}, {changedLinesText(chapter)} lines
      </span>
    </>
  )
}

/** The chapter's name and file names, with its summary line under them when it has one. */
function ChapterName({ chapter }: { chapter: Chapter }) {
  return (
    <span className="review-plan__name">
      <span className="review-plan__title">
        {chapter.name}
        <small>{fileNamesOf(chapter)}</small>
      </span>
      {chapter.summary && (
        <span className="review-plan__summary" data-testid="chapter-summary">
          {chapter.summary}
        </span>
      )}
    </span>
  )
}

function PlanRow({ chapter, number, largest, onStartAt }: RowProps) {
  // Named by a hidden label, not aria-label: the icon-tooltip installer shows any aria-label
  // that the visible text lacks, which put a tooltip under every row.
  const labelId = useId()
  const descriptionId = useId()
  return (
    <button
      type="button"
      className="review-plan__row"
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
      onClick={() => onStartAt(chapter.id)}
    >
      <RowAccessibleText chapter={chapter} labelId={labelId} descriptionId={descriptionId} />
      <span className="review-plan__number">{number}</span>
      <ChapterName chapter={chapter} />
      <span className="review-plan__files">{filesText(chapter.files.length)}</span>
      <span className="review-plan__change">
        <ChangeBar chapter={chapter} largest={largest} />
        <span className="review-plan__start">
          Start here <ArrowRight aria-hidden="true" />
        </span>
      </span>
      <span className="review-plan__lines">{changedLinesText(chapter)}</span>
    </button>
  )
}

interface RowProps {
  chapter: Chapter
  number: number
  largest: number
  onStartAt: (chapterId: string) => void
}

export function ReviewPlan({ chapters, onStartAt }: Props) {
  const headingId = useId()
  if (chapters.length === 0) return null
  const largest = Math.max(1, ...chapters.map(totalLines))
  return (
    <section className="review-plan" aria-labelledby={headingId}>
      <header className="review-plan__heading">
        <h2 id={headingId}>Review plan</h2>
        <span>
          {chapters.length} {plural(chapters.length, 'chapter')}
        </span>
      </header>
      <div className="review-plan__rows">
        {chapters.map((chapter, index) => (
          <PlanRow
            key={chapter.id}
            chapter={chapter}
            number={index + 1}
            largest={largest}
            onStartAt={onStartAt}
          />
        ))}
      </div>
    </section>
  )
}
