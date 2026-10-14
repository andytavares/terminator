import React from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, RotateCcw, Undo2, X } from 'lucide-react'
import { Button, IconButton } from '@terminator/extension-ui'
import { useMergeFlowStore } from '../../stores/merge-flow.store'
import type { ConflictFile } from '../../schemas/merge-flow.schema'
import { choose, splitPath } from '../text'

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

type MergeFile = ConflictFile

/** The active conflict's number across every file, and how many conflicts there are. */
function conflictPosition(files: MergeFile[], activeFile: number, activeBlock: number) {
  const blocksIn = (list: MergeFile[]) => list.reduce((n, f) => n + f.blocks.length, 0)
  const before = blocksIn(files.filter((_, i) => i < activeFile))
  const inActive = files[activeFile]?.blocks.length ?? 0
  const number = before + Math.min(Math.max(activeBlock, 0), inActive) + 1
  return { number, total: blocksIn(files) }
}

function Breadcrumb(props: { filePath: string; onBack: () => void }) {
  const { dir, name } = splitPath(props.filePath)
  return (
    <div className="conflict-header__breadcrumb">
      <Button
        variant="ghost"
        size="sm"
        icon={ArrowLeft}
        onClick={props.onBack}
        aria-label="Back to file list"
      >
        All files
      </Button>
      <span className="conflict-header__sep">/</span>
      <span className="conflict-header__filepath">
        <span className="conflict-header__file-dir">{dir}</span>
        <span className="conflict-header__file-name">{name}</span>
      </span>
    </div>
  )
}

function dotClass(resolved: boolean, active: boolean): string {
  const r = choose(resolved, ' conflict-header__dot--resolved', '')
  return `conflict-header__dot${r}${choose(active, ' conflict-header__dot--active', '')}`
}

function BlockDots(props: { file: MergeFile | undefined; activeBlock: number }) {
  return (
    <div className="conflict-header__dots">
      {props.file?.blocks.map((block, i) => (
        <span key={block.blockId} className={dotClass(block.isResolved, i === props.activeBlock)} />
      ))}
    </div>
  )
}

function ConflictNav({ nav }: { nav: Props }) {
  return (
    <div className="conflict-header__nav">
      <Button
        size="sm"
        icon={ChevronLeft}
        onClick={nav.onPrev}
        disabled={!nav.canPrev}
        aria-label="Previous conflict"
      >
        Prev
      </Button>
      <Button size="sm" onClick={nav.onNext} disabled={!nav.canNext} aria-label="Next conflict">
        Next <ChevronRight aria-hidden="true" className="tmui-button__icon" />
      </Button>
    </div>
  )
}

function HeaderActions({ nav }: { nav: Props }) {
  return (
    <>
      <Button
        variant="ghost"
        icon={Undo2}
        onClick={nav.onUndo}
        disabled={!nav.canUndo}
        aria-label="Undo last decision"
      >
        Undo last
      </Button>
      {nav.onStartOver && (
        <Button
          variant="ghost"
          icon={RotateCcw}
          onClick={nav.onStartOver}
          title="Reset all resolutions and start from scratch"
        >
          Start over
        </Button>
      )}
      {nav.onExit && <IconButton icon={X} label="Exit merge flow" onClick={nav.onExit} />}
    </>
  )
}

export function ConflictHeader(props: Props) {
  const session = useMergeFlowStore((s) => s.session)
  const activeFileIndex = useMergeFlowStore((s) => s.activeFileIndex)
  const activeBlockIndex = useMergeFlowStore((s) => s.activeBlockIndex)
  if (!session) return null
  const activeFile = session.files[activeFileIndex]
  const position = conflictPosition(session.files, activeFileIndex, activeBlockIndex)
  return (
    <div className="conflict-header">
      <Breadcrumb filePath={activeFile?.filePath ?? ''} onBack={props.onBack} />
      <BlockDots file={activeFile} activeBlock={activeBlockIndex} />
      <span className="conflict-header__counter">
        Conflict {position.number} of {position.total}
      </span>
      <ConflictNav nav={props} />
      <HeaderActions nav={props} />
    </div>
  )
}
