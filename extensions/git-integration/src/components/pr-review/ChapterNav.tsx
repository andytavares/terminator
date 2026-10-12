import React from 'react'
import { Check } from 'lucide-react'
import { Tab, TabList, TabsRoot } from '@terminator/extension-ui'
import type { Chapter } from '../../schemas/pr-review.schema'
import { usePrReviewStore } from '../../stores/pr-review.store'
import { chapterRiskLevel } from '../../github/pr-review-service'

interface Props {
  chapters: Chapter[]
  onSelectChapter?: (id: string) => void
}

type ChapterStatus = 'not-started' | 'in-progress' | 'complete'

function fileCount(chapter: Chapter): string {
  return `${chapter.files.length} ${chapter.files.length === 1 ? 'file' : 'files'}`
}

function chapterName(chapter: Chapter, status: ChapterStatus): string {
  const viewed = status === 'complete' ? ', viewed' : ''
  return `${chapter.name}, ${fileCount(chapter)}${viewed}`
}

export function ChapterNav({ chapters, onSelectChapter }: Props) {
  const currentChapterId = usePrReviewStore((s) => s.currentChapterId)
  const setCurrentChapter = usePrReviewStore((s) => s.setCurrentChapter)
  const viewedFiles = usePrReviewStore((s) => s.viewedFiles)

  function selectChapter(id: string) {
    setCurrentChapter(id)
    onSelectChapter?.(id)
  }

  function chapterStatus(chapter: Chapter): ChapterStatus {
    const viewed = chapter.files.filter((f) => viewedFiles.has(f.path)).length
    if (viewed === 0) return 'not-started'
    if (viewed === chapter.files.length) return 'complete'
    return 'in-progress'
  }

  if (chapters.length <= 1) return null

  const activeId = chapters.find((c) => c.id === currentChapterId)?.id ?? chapters[0].id

  return (
    <TabsRoot selectedId={activeId} onSelect={selectChapter}>
      <TabList label="PR chapters" orientation="vertical" className="chapter-nav">
        {chapters.map((ch) => {
          const status = chapterStatus(ch)
          return (
            <Tab
              key={ch.id}
              id={ch.id}
              accessibleName={chapterName(ch, status)}
              className={`chapter-nav-tab chapter-nav-tab--${status}`}
            >
              <span
                className={`chapter-nav-risk-dot chapter-nav-risk-dot--${chapterRiskLevel(ch)}`}
              />
              <span className="chapter-nav-name">{ch.name}</span>
              <span className="chapter-nav-meta">
                {fileCount(ch)} · {ch.estimatedMinutes}m
              </span>
              {status === 'complete' && (
                <span className="chapter-nav-check" aria-label="complete">
                  <Check aria-hidden="true" />
                </span>
              )}
            </Tab>
          )
        })}
      </TabList>
    </TabsRoot>
  )
}
