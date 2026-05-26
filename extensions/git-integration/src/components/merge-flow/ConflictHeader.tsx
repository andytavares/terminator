import React from 'react'
import { useMergeFlowStore } from '../../stores/merge-flow.store'

interface Props {
  onBack: () => void
  onPrev: () => void
  onNext: () => void
  onUndo: () => void
  canUndo: boolean
  canPrev: boolean
  canNext: boolean
  onStartOver?: () => void
  onExit?: () => void
}

export function ConflictHeader({
  onBack,
  onPrev,
  onNext,
  onUndo,
  canUndo,
  canPrev,
  canNext,
  onStartOver,
  onExit,
}: Props) {
  const session = useMergeFlowStore((s) => s.session)
  const activeFileIndex = useMergeFlowStore((s) => s.activeFileIndex)
  const activeBlockIndex = useMergeFlowStore((s) => s.activeBlockIndex)

  if (!session) return null

  const activeFile = session.files[activeFileIndex]
  // Compute global conflict number across all files
  let globalNum = 1
  let globalTotal = 0
  for (let fi = 0; fi < session.files.length; fi++) {
    const f = session.files[fi]
    for (let bi = 0; bi < f.blocks.length; bi++) {
      globalTotal++
      if (fi < activeFileIndex || (fi === activeFileIndex && bi < activeBlockIndex)) {
        globalNum++
      }
    }
  }

  const filePath = activeFile?.filePath ?? ''
  const slashIdx = filePath.lastIndexOf('/')
  const fileDir = slashIdx === -1 ? '' : filePath.slice(0, slashIdx + 1)
  const fileName = slashIdx === -1 ? filePath : filePath.slice(slashIdx + 1)

  return (
    <div className="conflict-header">
      {/* Breadcrumb */}
      <div className="conflict-header__breadcrumb">
        <button className="conflict-header__back" onClick={onBack} aria-label="Back to file list">
          ← All files
        </button>
        <span className="conflict-header__sep">/</span>
        <span className="conflict-header__filepath">
          <span className="conflict-header__file-dir">{fileDir}</span>
          <span className="conflict-header__file-name">{fileName}</span>
        </span>
      </div>

      {/* Dots */}
      <div className="conflict-header__dots">
        {activeFile?.blocks.map((block, i) => (
          <span
            key={block.blockId}
            className={`conflict-header__dot${block.isResolved ? ' conflict-header__dot--resolved' : ''}${i === activeBlockIndex ? ' conflict-header__dot--active' : ''}`}
          />
        ))}
      </div>

      {/* Counter + navigation */}
      <span className="conflict-header__counter">
        Conflict {globalNum} of {globalTotal}
      </span>

      <div className="conflict-header__nav">
        <button
          className="conflict-header__nav-btn"
          onClick={onPrev}
          disabled={!canPrev}
          aria-label="Previous conflict"
        >
          ← Prev
        </button>
        <button
          className="conflict-header__nav-btn"
          onClick={onNext}
          disabled={!canNext}
          aria-label="Next conflict"
        >
          Next →
        </button>
      </div>

      <button
        className="conflict-header__undo"
        onClick={onUndo}
        disabled={!canUndo}
        aria-label="Undo last decision"
      >
        ↩ Undo last
      </button>

      {onStartOver && (
        <button
          className="conflict-header__start-over"
          onClick={onStartOver}
          aria-label="Start over"
          title="Reset all resolutions and start from scratch"
        >
          ↺ Start over
        </button>
      )}

      {onExit && (
        <button
          className="conflict-header__exit"
          onClick={onExit}
          aria-label="Exit merge flow"
          title="Exit merge flow"
        >
          ✕
        </button>
      )}
    </div>
  )
}
