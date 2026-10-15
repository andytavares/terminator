import React, { useId } from 'react'
import { ArrowRight } from 'lucide-react'
import { plural } from '@terminator/extension-sdk'
import type { Chapter } from '../../schemas/pr-review.schema'
import { chapterRiskLevel } from '../../github/pr-review-service'
import { choose, splitPath } from '../text'
import './review-plan.css'

interface Props {
  chapters: Chapter[]
  onStartAt: (chapterId: string) => void
}

const SHOWN_FILE_NAMES = 3

const RISK_LABEL = { high: 'High risk', medium: 'Medium', low: 'Low' } as const

function totalLines(chapter: Chapter): number {
  return chapter.files.reduce((sum, f) => sum + f.additions + f.deletions, 0)
}

function fileNamesOf(chapter: Chapter): string {
  const names = chapter.files.slice(0, SHOWN_FILE_NAMES).map((f) => splitPath(f.path).name)
  const hidden = chapter.files.length - SHOWN_FILE_NAMES
  return names.join(', ') + choose(hidden > 0, ` +${hidden}`, '')
}

function ChangeBar({ chapter, largest }: { chapter: Chapter; largest: number }) {
  const added = chapter.files.reduce((sum, f) => sum + f.additions, 0)
  const removed = totalLines(chapter) - added
  return (
    <span className="review-plan__bar" aria-hidden="true">
      <b className="review-plan__bar-added" style={{ width: `${(added / largest) * 100}%` }} />
      <b className="review-plan__bar-removed" style={{ width: `${(removed / largest) * 100}%` }} />
    </span>
  )
}

/** Risk and file count: the two facts between a chapter's name and its size. */
function ChapterFacts({ chapter }: { chapter: Chapter }) {
  const risk = chapterRiskLevel(chapter)
  const fileCount = chapter.files.length
  return (
    <>
      <span className={`review-plan__risk review-plan__risk--${risk}`}>{RISK_LABEL[risk]}</span>
      <span className="review-plan__files">
        {fileCount} {plural(fileCount, 'file')}
      </span>
    </>
  )
}

function PlanRow({ chapter, number, largest, onStartAt }: RowProps) {
  // Named by a hidden label, not aria-label: the icon-tooltip installer shows any aria-label
  // that the visible text lacks, which put a tooltip under every row.
  const labelId = useId()
  return (
    <button
      type="button"
      className="review-plan__row"
      aria-labelledby={labelId}
      onClick={() => onStartAt(chapter.id)}
    >
      <span id={labelId} className="review-plan__hidden">
        Start review at {chapter.name}
      </span>
      <span className="review-plan__number">{number}</span>
      <span className="review-plan__name">
        {chapter.name}
        <small>{fileNamesOf(chapter)}</small>
      </span>
      <ChapterFacts chapter={chapter} />
      <span className="review-plan__change">
        <ChangeBar chapter={chapter} largest={largest} />
        <span className="review-plan__start">
          Start here <ArrowRight aria-hidden="true" />
        </span>
      </span>
      <span className="review-plan__minutes">{chapter.estimatedMinutes} min</span>
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
  if (chapters.length === 0) return null
  const largest = Math.max(1, ...chapters.map(totalLines))
  const minutes = chapters.reduce((sum, c) => sum + c.estimatedMinutes, 0)
  return (
    <section className="review-plan" aria-labelledby="review-plan-heading">
      <header className="review-plan__heading">
        <h3 id="review-plan-heading">Review plan</h3>
        <span>
          {chapters.length} {plural(chapters.length, 'chapter')} · about {minutes} min
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
