import React, { useRef, useState } from 'react'
import { usePrReviewStore } from '../../stores/pr-review.store'
import type { Chapter, PrChangedFile } from '../../schemas/pr-review.schema'
import {
  classNames,
  currentAttr,
  orderedFiles,
  rowState,
  FileRowContent,
  type SinceSets,
} from './file-rows'

interface Props {
  repoRoot: string
  prNumber: number
  headSHA: string
  chapter: Chapter
  currentFilePath: string | null
  onSelectFile: (path: string) => void
}

/** `paths` with the one at `from` moved to `to`. */
function movedPath(paths: string[], from: number, to: number): string[] {
  const next = [...paths]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

type ReorderFiles = ReturnType<typeof usePrReviewStore.getState>['reorderFiles']

interface DragTarget {
  props: Props
  files: PrChangedFile[]
  reorderFiles: ReorderFiles
}

/** Stores the order with the dragged row moved onto the one it was dropped on. */
function dropRow(target: DragTarget, from: number | null, to: number): void {
  if (from == null || from === to) return
  const { repoRoot, prNumber, headSHA, chapter } = target.props
  const order = movedPath(
    target.files.map((f) => f.path),
    from,
    to
  )
  target.reorderFiles({ repoRoot, prNumber, headSHA }, chapter.id, order)
}

/** Drag a row onto another to move it there; the new order is stored per chapter. */
function useRowDrag(target: DragTarget) {
  const dragIndexRef = useRef<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const endFileDrag = () => {
    dragIndexRef.current = null
    setDragOverIndex(null)
  }
  const fileDragHandlers = (index: number) => ({
    onDragStart: () => {
      dragIndexRef.current = index
    },
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      setDragOverIndex(index)
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      dropRow(target, dragIndexRef.current, index)
      endFileDrag()
    },
    onDragEnd: endFileDrag,
  })
  return { dragOverIndex, handlersFor: fileDragHandlers }
}

type RowDrag = ReturnType<typeof useRowDrag>

interface FileRowProps {
  file: PrChangedFile
  index: number
  sets: SinceSets
  threadCount: number
  isActive: boolean
  drag: RowDrag
  onSelectFile: (path: string) => void
}

function ChapterFileRow(props: FileRowProps) {
  const { file, index, isActive, onSelectFile } = props
  const isViewed = props.sets.viewedFiles.has(file.path)
  const state = rowState(file, props.sets)
  const className = classNames('chapter-file-row file-tree-row', {
    'chapter-file-row--active': isActive,
    'chapter-file-row--viewed': isViewed,
    'chapter-file-row--drag-over': props.drag.dragOverIndex === index,
  })
  return (
    <div
      aria-current={currentAttr(isActive)}
      className={className}
      draggable
      {...props.drag.handlersFor(index)}
      onClick={() => onSelectFile(file.path)}
      role="button"
      title={file.path}
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelectFile(file.path)}
    >
      <FileRowContent
        file={file}
        state={state}
        isViewed={isViewed}
        threadCount={props.threadCount}
      />
    </div>
  )
}

export function ChapterFileList(props: Props) {
  const { chapter, currentFilePath } = props
  const {
    viewedFiles,
    fileOrderOverrides,
    reorderFiles,
    threads = {},
    changedSince = new Set<string>(),
    newSinceLook = new Set<string>(),
  } = usePrReviewStore()
  const files = orderedFiles(chapter, fileOrderOverrides[chapter.id])
  const drag = useRowDrag({ props, files, reorderFiles })
  const sets = { viewedFiles, changedSince, newSinceLook }
  return (
    <div className="chapter-file-list file-tree">
      {files.map((file, index) => (
        <ChapterFileRow
          key={file.path}
          file={file}
          index={index}
          sets={sets}
          threadCount={threads[file.path]?.length ?? 0}
          isActive={file.path === currentFilePath}
          drag={drag}
          onSelectFile={props.onSelectFile}
        />
      ))}
    </div>
  )
}
