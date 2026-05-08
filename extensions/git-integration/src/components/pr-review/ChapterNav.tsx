import React from 'react'
import type { Chapter } from '../../schemas/pr-review.schema'
import { usePrReviewStore } from '../../stores/pr-review.store'

interface Props {
  chapters: Chapter[]
}

export function ChapterNav({ chapters }: Props) {
  const { currentChapterId, setCurrentChapter, viewedFiles } = usePrReviewStore()

  function chapterStatus(chapter: Chapter): 'not-started' | 'in-progress' | 'complete' {
    const viewed = chapter.files.filter(f => viewedFiles.has(f.path)).length
    if (viewed === 0) return 'not-started'
    if (viewed === chapter.files.length) return 'complete'
    return 'in-progress'
  }

  if (chapters.length <= 1) return null

  return (
    <div className="chapter-nav" role="tablist" aria-label="PR chapters">
      {chapters.map(ch => {
        const status = chapterStatus(ch)
        const isActive = ch.id === currentChapterId
        return (
          <button
            key={ch.id}
            role="tab"
            aria-selected={isActive}
            className={`chapter-nav-tab chapter-nav-tab--${status}${isActive ? ' chapter-nav-tab--active' : ''}`}
            onClick={() => setCurrentChapter(ch.id)}
          >
            <span className="chapter-nav-name">{ch.name}</span>
            <span className="chapter-nav-meta">{ch.files.length} files · {ch.estimatedMinutes}m</span>
            {status === 'complete' && <span className="chapter-nav-check" aria-label="complete">✓</span>}
          </button>
        )
      })}
    </div>
  )
}
