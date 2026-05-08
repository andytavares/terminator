import React, { useRef, useState } from 'react'
import { usePrReviewStore } from '../../stores/pr-review.store'
import type { Chapter, PrChangedFile } from '../../../../../src/shared/schemas/pr-review.schema'

interface Props {
  repoRoot: string
  prNumber: number
  headSHA: string
  chapter: Chapter
  currentFilePath: string | null
  onSelectFile: (path: string) => void
}

export function ChapterFileList({ repoRoot, prNumber, headSHA, chapter, currentFilePath, onSelectFile }: Props) {
  const { viewedFiles, fileOrderOverrides, reorderFiles } = usePrReviewStore()
  const overrideOrder = fileOrderOverrides[chapter.id]
  const files = overrideOrder
    ? overrideOrder.map(p => chapter.files.find(f => f.path === p)).filter((f): f is PrChangedFile => !!f)
    : chapter.files

  const dragIndexRef = useRef<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const handleDragStart = (index: number) => {
    dragIndexRef.current = index
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
  }

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()
    const fromIndex = dragIndexRef.current
    if (fromIndex == null || fromIndex === dropIndex) {
      dragIndexRef.current = null
      setDragOverIndex(null)
      return
    }
    const newOrder = [...files.map(f => f.path)]
    const [moved] = newOrder.splice(fromIndex, 1)
    newOrder.splice(dropIndex, 0, moved)
    reorderFiles(chapter.id, newOrder, repoRoot, prNumber, headSHA)
    dragIndexRef.current = null
    setDragOverIndex(null)
  }

  const handleDragEnd = () => {
    dragIndexRef.current = null
    setDragOverIndex(null)
  }

  return (
    <div className="chapter-file-list">
      {files.map((file, index) => {
        const isActive   = file.path === currentFilePath
        const isViewed   = viewedFiles.has(file.path)
        const isDragOver = dragOverIndex === index

        return (
          <div
            key={file.path}
            className={[
              'chapter-file-row',
              isActive   ? 'chapter-file-row--active'    : '',
              isViewed   ? 'chapter-file-row--viewed'    : '',
              isDragOver ? 'chapter-file-row--drag-over' : '',
            ].filter(Boolean).join(' ')}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragOver={e => handleDragOver(e, index)}
            onDrop={e => handleDrop(e, index)}
            onDragEnd={handleDragEnd}
            onClick={() => onSelectFile(file.path)}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && onSelectFile(file.path)}
          >
            <span className="chapter-file-num">{index + 1}</span>
            <span className={`chapter-file-risk-dot chapter-file-risk-dot--${file.riskScore.level}`} />
            <span className="chapter-file-name" title={file.path}>
              {file.path.split('/').pop()}
            </span>
            <span className="chapter-file-changes">
              <span className="chapter-file-add">+{file.additions}</span>
              <span className="chapter-file-del">−{file.deletions}</span>
            </span>
            {isViewed && <span className="chapter-file-viewed-check" aria-label="Viewed">✓</span>}
            <span className="chapter-file-why" title={file.whyHere}>{file.whyHere}</span>
          </div>
        )
      })}
    </div>
  )
}
