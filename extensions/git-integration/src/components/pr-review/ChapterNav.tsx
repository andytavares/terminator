import React, { useRef } from 'react'
import { Check } from 'lucide-react'
import type { Chapter } from '../../schemas/pr-review.schema'
import { usePrReviewStore } from '../../stores/pr-review.store'
import { chapterRiskLevel } from '../../github/pr-review-service'

interface Props {
  chapters: Chapter[]
  onSelectChapter?: (id: string) => void
}

export function ChapterNav({ chapters, onSelectChapter }: Props) {
  const currentChapterId = usePrReviewStore((s) => s.currentChapterId)
  const setCurrentChapter = usePrReviewStore((s) => s.setCurrentChapter)
  const viewedFiles = usePrReviewStore((s) => s.viewedFiles)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  function selectChapter(id: string) {
    setCurrentChapter(id)
    onSelectChapter?.(id)
  }

  function handleKeyDown(e: React.KeyboardEvent, index: number) {
    const last = chapters.length - 1
    let target: number
    switch (e.key) {
      case 'ArrowDown':
        target = index === last ? 0 : index + 1
        break
      case 'ArrowUp':
        target = index === 0 ? last : index - 1
        break
      case 'Home':
        target = 0
        break
      case 'End':
        target = last
        break
      default:
        return
    }
    e.preventDefault()
    tabRefs.current[target]?.focus()
    selectChapter(chapters[target].id)
  }

  function chapterStatus(chapter: Chapter): 'not-started' | 'in-progress' | 'complete' {
    const viewed = chapter.files.filter((f) => viewedFiles.has(f.path)).length
    if (viewed === 0) return 'not-started'
    if (viewed === chapter.files.length) return 'complete'
    return 'in-progress'
  }

  if (chapters.length <= 1) return null

  const activeId = chapters.some((c) => c.id === currentChapterId)
    ? currentChapterId
    : chapters[0].id

  return (
    <div
      className="chapter-nav"
      role="tablist"
      aria-label="PR chapters"
      aria-orientation="vertical"
    >
      {chapters.map((ch, index) => {
        const status = chapterStatus(ch)
        const isActive = ch.id === activeId
        return (
          <button
            key={ch.id}
            ref={(el) => {
              tabRefs.current[index] = el
            }}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={`chapter-nav-tab chapter-nav-tab--${status}${isActive ? ' chapter-nav-tab--active' : ''}`}
            onClick={() => selectChapter(ch.id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
          >
            <span
              className={`chapter-nav-risk-dot chapter-nav-risk-dot--${chapterRiskLevel(ch)}`}
            />
            <span className="chapter-nav-name">{ch.name}</span>
            <span className="chapter-nav-meta">
              {ch.files.length} {ch.files.length === 1 ? 'file' : 'files'} · {ch.estimatedMinutes}m
            </span>
            {status === 'complete' && (
              <span className="chapter-nav-check" aria-label="complete">
                <Check aria-hidden="true" />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
