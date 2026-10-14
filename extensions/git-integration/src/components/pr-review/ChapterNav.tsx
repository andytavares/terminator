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
  const count = chapter.files.length
  if (count === 1) return '1 file'
  return `${count} files`
}

function chapterName(chapter: Chapter, status: ChapterStatus): string {
  const name = `${chapter.name}, ${fileCount(chapter)}`
  if (status === 'complete') return `${name}, viewed`
  return name
}

function chapterStatusOf(chapter: Chapter, viewedFiles: Set<string>): ChapterStatus {
  const viewed = chapter.files.filter((f) => viewedFiles.has(f.path)).length
  if (viewed === 0) return 'not-started'
  if (viewed === chapter.files.length) return 'complete'
  return 'in-progress'
}

function chapterTab(chapter: Chapter, status: ChapterStatus) {
  return (
    <Tab
      key={chapter.id}
      id={chapter.id}
      accessibleName={chapterName(chapter, status)}
      className={`chapter-nav-tab chapter-nav-tab--${status}`}
    >
      <span className={`chapter-nav-risk-dot chapter-nav-risk-dot--${chapterRiskLevel(chapter)}`} />
      <span className="chapter-nav-name">{chapter.name}</span>
      <span className="chapter-nav-meta">
        {fileCount(chapter)} · {chapter.estimatedMinutes}m
      </span>
      {status === 'complete' && (
        <span className="chapter-nav-check" aria-label="complete">
          <Check aria-hidden="true" />
        </span>
      )}
    </Tab>
  )
}

export function ChapterNav({ chapters, onSelectChapter }: Props) {
  const currentChapterId = usePrReviewStore((s) => s.currentChapterId)
  const setCurrentChapter = usePrReviewStore((s) => s.setCurrentChapter)
  const viewedFiles = usePrReviewStore((s) => s.viewedFiles)
  function selectChapter(id: string) {
    setCurrentChapter(id)
    onSelectChapter?.(id)
  }
  if (chapters.length <= 1) return null
  const activeId = chapters.find((c) => c.id === currentChapterId)?.id ?? chapters[0].id
  return (
    <TabsRoot selectedId={activeId} onSelect={selectChapter}>
      <TabList label="PR chapters" orientation="vertical" className="chapter-nav">
        {chapters.map((ch) => chapterTab(ch, chapterStatusOf(ch, viewedFiles)))}
      </TabList>
    </TabsRoot>
  )
}
