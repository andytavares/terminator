import React, { useState } from 'react'
import { usePrReviewStore } from '../../stores/pr-review.store'
import type { PrReviewDetail, Chapter, PrChangedFile } from '../../schemas/pr-review.schema'
import { chapterRiskLevel } from '../../github/pr-review-service'

interface Props {
  pr: PrReviewDetail
  repoRoot: string
  headSHA: string
  currentFilePath: string | null
  onSelectFile: (path: string, chapterId: string) => void
}

export function FullFileList({ pr, repoRoot: _repoRoot, headSHA: _headSHA, currentFilePath, onSelectFile }: Props) {
  const { viewedFiles, fileOrderOverrides } = usePrReviewStore()

  const totalFiles   = pr.chapters.reduce((n, c) => n + c.files.length, 0)
  const totalViewed  = pr.chapters.reduce((n, c) => n + c.files.filter(f => viewedFiles.has(f.path)).length, 0)
  const totalMinutes = pr.chapters.reduce((n, c) => n + c.estimatedMinutes, 0)

  // Chapters collapsed by default only if they are complete
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(pr.chapters.map(c => [c.id, false]))
  )

  const toggleCollapsed = (id: string) =>
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }))

  const chapterStatus = (ch: Chapter): 'not-started' | 'in-progress' | 'complete' => {
    const viewed = ch.files.filter(f => viewedFiles.has(f.path)).length
    if (viewed === 0) return 'not-started'
    if (viewed === ch.files.length) return 'complete'
    return 'in-progress'
  }

  return (
    <div className="full-file-list">
      {/* Summary row */}
      <div className="full-file-list-summary">
        <span>{totalViewed} / {totalFiles} files reviewed</span>
        <span>~{totalMinutes}m</span>
      </div>

      {pr.chapters.map((chapter, ci) => {
        const status  = chapterStatus(chapter)
        const isOpen  = !collapsed[chapter.id]
        const overrideOrder = fileOrderOverrides[chapter.id]
        const files: PrChangedFile[] = overrideOrder
          ? overrideOrder.map(p => chapter.files.find(f => f.path === p)).filter((f): f is PrChangedFile => !!f)
          : chapter.files

        const viewedInChapter = files.filter(f => viewedFiles.has(f.path)).length

        return (
          <div key={chapter.id} className={`full-file-chapter full-file-chapter--${status}`}>
            {/* Chapter header */}
            <button
              className="full-file-chapter-header"
              onClick={() => toggleCollapsed(chapter.id)}
              aria-expanded={isOpen}
            >
              <span className={`full-file-chapter-status full-file-chapter-status--${status}`} />
              <span className="full-file-chapter-num">Ch {ci + 1}</span>
              <span className="full-file-chapter-name">{chapter.name}</span>
              {chapter.files.some(f => f.tier !== 3) ? (
                <span className={`full-file-chapter-risk full-file-chapter-risk--${chapterRiskLevel(chapter)}`}>
                  {chapterRiskLevel(chapter)}
                </span>
              ) : (
                <span className="full-file-chapter-risk full-file-chapter-risk--none">auto</span>
              )}
              <span className="full-file-chapter-progress">{viewedInChapter}/{files.length}</span>
              {status === 'complete' && <span className="full-file-chapter-done">✓</span>}
              <span className="full-file-chapter-chevron">{isOpen ? '▾' : '▸'}</span>
            </button>

            {/* File rows */}
            {isOpen && files.map((file, fi) => {
              const isActive = file.path === currentFilePath
              const isViewed = viewedFiles.has(file.path)
              return (
                <button
                  key={file.path}
                  className={[
                    'full-file-row',
                    isActive  ? 'full-file-row--active'  : '',
                    isViewed  ? 'full-file-row--viewed'  : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => onSelectFile(file.path, chapter.id)}
                  title={file.path}
                >
                  <span className="full-file-row-num">{fi + 1}</span>
                  <span className={`full-file-row-risk full-file-row-risk--${file.tier === 3 ? 'none' : file.riskScore.level}`} />
                  <span className="full-file-row-name">{file.path.split('/').pop()}</span>
                  <span className="full-file-row-changes">
                    <span className="full-file-row-add">+{file.additions}</span>
                    <span className="full-file-row-del">−{file.deletions}</span>
                  </span>
                  {isViewed && <span className="full-file-row-check">✓</span>}
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
