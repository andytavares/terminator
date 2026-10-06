import React, { useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Dot, Plus } from 'lucide-react'
import { usePrReviewStore } from '../../stores/pr-review.store'
import type { PrReviewDetail, Chapter, PrChangedFile } from '../../schemas/pr-review.schema'
import { chapterRiskLevel } from '../../github/pr-review-service'

type RowState = 'viewed' | 'changed' | 'new' | 'default'

function rowState(
  file: PrChangedFile,
  viewedFiles: Set<string>,
  changedSince: Set<string>,
  newSinceLook: Set<string>
): RowState {
  if (changedSince.has(file.path)) return 'changed'
  if (newSinceLook.has(file.path)) return 'new'
  if (viewedFiles.has(file.path)) return 'viewed'
  return 'default'
}

interface Props {
  pr: PrReviewDetail
  repoRoot: string
  headSHA: string
  currentFilePath: string | null
  onSelectFile: (path: string, chapterId: string) => void
  showChapterHeaders?: boolean
}

export function FullFileList({
  pr,
  repoRoot: _repoRoot,
  headSHA: _headSHA,
  currentFilePath,
  onSelectFile,
  showChapterHeaders = true,
}: Props) {
  const {
    viewedFiles,
    fileOrderOverrides,
    changedSince = new Set<string>(),
    newSinceLook = new Set<string>(),
  } = usePrReviewStore()

  const reasonByPath = useMemo(() => {
    const map = new Map<string, { reason: string; allUsesViewed: boolean }>()
    for (const step of pr.readingOrder ?? []) {
      const allUsesViewed = step.uses.every(
        (u) => u.definedInPath == null || viewedFiles.has(u.definedInPath)
      )
      map.set(step.path, { reason: step.reason, allUsesViewed })
    }
    return map
  }, [pr.readingOrder, viewedFiles])

  // Chapters collapsed by default only if they are complete
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(pr.chapters.map((c) => [c.id, false]))
  )

  const toggleCollapsed = (id: string) => setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))

  const chapterStatus = (ch: Chapter): 'not-started' | 'in-progress' | 'complete' => {
    const viewed = ch.files.filter((f) => viewedFiles.has(f.path)).length
    if (viewed === 0) return 'not-started'
    if (viewed === ch.files.length) return 'complete'
    return 'in-progress'
  }

  return (
    <div className="full-file-list">
      {pr.chapters.map((chapter, ci) => {
        const status = chapterStatus(chapter)
        const isOpen = !collapsed[chapter.id]
        const overrideOrder = fileOrderOverrides[chapter.id]
        const files: PrChangedFile[] = overrideOrder
          ? overrideOrder
              .map((p) => chapter.files.find((f) => f.path === p))
              .filter((f): f is PrChangedFile => !!f)
          : chapter.files

        const viewedInChapter = files.filter((f) => viewedFiles.has(f.path)).length

        const showFiles = !showChapterHeaders || isOpen

        return (
          <div key={chapter.id} className={`full-file-chapter full-file-chapter--${status}`}>
            {/* Chapter header — hidden when there's only one chapter */}
            {showChapterHeaders && (
              <button
                className="full-file-chapter-header"
                onClick={() => toggleCollapsed(chapter.id)}
                aria-expanded={isOpen}
              >
                <span className={`full-file-chapter-status full-file-chapter-status--${status}`} />
                <span className="full-file-chapter-num">Chapter {ci + 1}</span>
                <span className="full-file-chapter-name">{chapter.name}</span>
                {chapter.files.some((f) => f.tier !== 3) ? (
                  <span
                    className={`full-file-chapter-risk full-file-chapter-risk--${chapterRiskLevel(chapter)}`}
                  >
                    {chapterRiskLevel(chapter)}
                  </span>
                ) : (
                  <span className="full-file-chapter-risk full-file-chapter-risk--none">auto</span>
                )}
                <span className="full-file-chapter-progress">
                  {viewedInChapter}/{files.length}
                </span>
                {status === 'complete' && (
                  <Check aria-hidden="true" className="full-file-chapter-done" />
                )}
                {isOpen ? (
                  <ChevronDown aria-hidden="true" className="full-file-chapter-chevron" />
                ) : (
                  <ChevronRight aria-hidden="true" className="full-file-chapter-chevron" />
                )}
              </button>
            )}

            {/* File rows */}
            {showFiles &&
              files.map((file, fi) => {
                const isActive = file.path === currentFilePath
                const isViewed = viewedFiles.has(file.path)
                const state = rowState(file, viewedFiles, changedSince, newSinceLook)
                const reasonInfo = reasonByPath.get(file.path)
                return (
                  <button
                    key={file.path}
                    className={[
                      'full-file-row',
                      isActive ? 'full-file-row--active' : '',
                      isViewed ? 'full-file-row--viewed' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => onSelectFile(file.path, chapter.id)}
                    aria-current={isActive ? 'true' : undefined}
                    title={file.path}
                  >
                    {state === 'default' ? (
                      <span className="full-file-row-num">{fi + 1}</span>
                    ) : (
                      <span className="rc-frow-state">
                        {state === 'viewed' && <Check aria-hidden="true" />}
                        {state === 'changed' && <Dot aria-hidden="true" />}
                        {state === 'new' && <Plus aria-hidden="true" />}
                      </span>
                    )}
                    <span
                      className={`full-file-row-risk full-file-row-risk--${file.tier === 3 ? 'none' : file.riskScore.level}`}
                    />
                    <span className="full-file-row-body">
                      <span className="full-file-row-name">{file.path.split('/').pop()}</span>
                      {reasonInfo && (
                        <span
                          className={`rc-frow-reason${reasonInfo.allUsesViewed ? ' rc-frow-reason--viewed' : ''}`}
                        >
                          {reasonInfo.reason}
                        </span>
                      )}
                    </span>
                    <span className="full-file-row-changes">
                      <span className="full-file-row-add">+{file.additions}</span>
                      <span className="full-file-row-del">−{file.deletions}</span>
                    </span>
                    {state !== 'default' && (
                      <span className={`rc-frow-sub rc-frow-sub--${state}`}>
                        {state === 'viewed'
                          ? 'viewed'
                          : state === 'changed'
                            ? 'changed'
                            : 'new file'}
                      </span>
                    )}
                  </button>
                )
              })}
          </div>
        )
      })}
    </div>
  )
}
