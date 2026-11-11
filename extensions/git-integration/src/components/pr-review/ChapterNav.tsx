import React from 'react'
import { Check } from 'lucide-react'
import type { Chapter } from '../../schemas/pr-review.schema'
import { usePrReviewStore } from '../../stores/pr-review.store'
import { currentAttr } from './file-rows'

interface Props {
  chapters: Chapter[]
  onSelectChapter?: (id: string) => void
  /** The current chapter's file list, shown directly under its header. */
  children?: React.ReactNode
}

function fileCount(chapter: Chapter): string {
  const count = chapter.files.length
  if (count === 1) return '1 file'
  return `${count} files`
}

function chapterName(chapter: Chapter, complete: boolean): string {
  const name = `${chapter.name}, ${fileCount(chapter)}`
  if (complete) return `${name}, viewed`
  return name
}

interface ChapterOutlineHeaderProps {
  chapter: Chapter
  num: number
  viewedCount: number
  isCurrent: boolean
  onSelect: () => void
}

function ChapterOutlineHeader(props: ChapterOutlineHeaderProps) {
  const { chapter, viewedCount, isCurrent } = props
  const complete = viewedCount === chapter.files.length
  return (
    <button
      type="button"
      aria-label={chapterName(chapter, complete)}
      aria-expanded={isCurrent}
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
        {viewedCount}/{chapter.files.length}
      </span>
      {complete && (
        <span className="chapter-nav-check" aria-label="complete">
          <Check aria-hidden="true" />
        </span>
      )}
    </button>
  )
}

/** The chapters as one outline: each header with the current chapter's files right under it. */
export function ChapterNav({ chapters, onSelectChapter, children }: Props) {
  const currentChapterId = usePrReviewStore((s) => s.currentChapterId)
  const setCurrentChapter = usePrReviewStore((s) => s.setCurrentChapter)
  const viewedFiles = usePrReviewStore((s) => s.viewedFiles)
  if (chapters.length <= 1) return <>{children}</>
  const activeId = chapters.find((c) => c.id === currentChapterId)?.id ?? chapters[0].id
  const selectChapter = (id: string) => {
    setCurrentChapter(id)
    onSelectChapter?.(id)
  }
  return (
    <nav aria-label="PR chapters" className="chapter-nav">
      {chapters.map((chapter, index) => (
        <section key={chapter.id} className="chapter-nav-group">
          <ChapterOutlineHeader
            chapter={chapter}
            num={index + 1}
            viewedCount={chapter.files.filter((f) => viewedFiles.has(f.path)).length}
            isCurrent={chapter.id === activeId}
            onSelect={() => selectChapter(chapter.id)}
          />
          {chapter.id === activeId && children}
        </section>
      ))}
    </nav>
  )
}
