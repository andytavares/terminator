import React from 'react'
import { Check } from 'lucide-react'
import type { Chapter } from '../../schemas/pr-review.schema'
import type { HunkProgress } from '../../review/review-layout'
import { currentAttr } from './file-rows'

interface Props {
  chapters: Chapter[]
  /** Each chapter's read hunks, by chapter id. */
  progress: Record<string, HunkProgress>
  activeId: string | null
  onSelectChapter: (id: string) => void
}

interface ChapterRowProps {
  chapter: Chapter
  num: number
  progress: HunkProgress
  isCurrent: boolean
  onSelect: () => void
}

function ChapterRow(props: ChapterRowProps) {
  const { chapter, progress, isCurrent } = props
  const complete = progress.total > 0 && progress.read === progress.total
  return (
    <button
      type="button"
      aria-label={`${chapter.name}, ${progress.read} of ${progress.total} hunks read`}
      aria-current={currentAttr(isCurrent)}
      className="chapter-nav-header"
      onClick={props.onSelect}
    >
      <span className="chapter-nav-num">{props.num}</span>
      <span className="chapter-nav-main">
        <span className="chapter-nav-name">{chapter.name}</span>
        {chapter.summary && <span className="chapter-nav-summary">{chapter.summary}</span>}
      </span>
      <span className="chapter-nav-meta">
        {progress.read}/{progress.total}
      </span>
      {complete && (
        <span className="chapter-nav-check" aria-label="complete">
          <Check aria-hidden="true" />
        </span>
      )}
    </button>
  )
}

/** The chapter rail: every chapter with its read hunks; picking one opens it. */
export function ChapterNav({ chapters, progress, activeId, onSelectChapter }: Props) {
  return (
    <nav aria-label="PR chapters" className="chapter-nav">
      {chapters.map((chapter, index) => (
        <section key={chapter.id} className="chapter-nav-group">
          <ChapterRow
            chapter={chapter}
            num={index + 1}
            progress={progress[chapter.id] ?? { read: 0, total: 0 }}
            isCurrent={chapter.id === activeId}
            onSelect={() => onSelectChapter(chapter.id)}
          />
        </section>
      ))}
    </nav>
  )
}
