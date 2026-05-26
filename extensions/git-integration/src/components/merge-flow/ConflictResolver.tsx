import React, { useEffect, useCallback } from 'react'

const CONFLICT_MARKER_RE = /^(<{7}.*|={7}|>{7}.*)\n?/gm
function stripConflictMarkers(text: string): string {
  return text.replace(CONFLICT_MARKER_RE, '')
}
import { useMergeFlowStore } from '../../stores/merge-flow.store'
import { mergeFlowAPI } from '../../api/merge-flow'
import { useToastStore } from '../../../../../src/renderer/stores/toast.store'
import { ConflictHeader } from './ConflictHeader'
import { ConflictPanel } from './ConflictPanel'
import { ResultPreviewStrip } from './ResultPreviewStrip'
import { ActionBar } from './ActionBar'
import { KeepBothModal } from './KeepBothModal'
import { ManualEditor } from './ManualEditor'

interface Props {
  repoRoot: string
  onBack: () => void
  onComplete: () => void
  onStartOver?: () => void
  onExit?: () => void
}

export function ConflictResolver({ repoRoot, onBack, onComplete, onStartOver, onExit }: Props) {
  const session = useMergeFlowStore((s) => s.session)
  const activeFileIndex = useMergeFlowStore((s) => s.activeFileIndex)
  const activeBlockIndex = useMergeFlowStore((s) => s.activeBlockIndex)
  const isKeepBothOpen = useMergeFlowStore((s) => s.isKeepBothOpen)
  const goToNextBlock = useMergeFlowStore((s) => s.goToNextBlock)
  const goToPrevBlock = useMergeFlowStore((s) => s.goToPrevBlock)
  const openKeepBoth = useMergeFlowStore((s) => s.openKeepBoth)
  const closeKeepBoth = useMergeFlowStore((s) => s.closeKeepBoth)
  const confirmDecision = useMergeFlowStore((s) => s.confirmDecision)
  const undoLastDecision = useMergeFlowStore((s) => s.undoLastDecision)
  const undoStackLength = useMergeFlowStore((s) => s._undoStack.length)
  const { addToast } = useToastStore()

  const [manualMode, setManualMode] = React.useState(false)
  const [manualSuggestedText, setManualSuggestedText] = React.useState<string | null>(null)
  const [pendingResolution, setPendingResolution] = React.useState<{
    text: string
    strategy: 'ours' | 'theirs' | 'both-ours-first' | 'both-theirs-first' | 'manual'
  } | null>(null)

  // Close the editor and clear per-block state whenever the user navigates to a new block
  React.useEffect(() => {
    setManualMode(false)
    setManualSuggestedText(null)
    setPendingResolution(null)
  }, [activeBlockIndex, activeFileIndex])

  const activeFile = session?.files[activeFileIndex]
  const activeBlock = activeFile?.blocks[activeBlockIndex]

  const handleResolve = useCallback(
    async (
      resolvedText: string,
      strategy: typeof pendingResolution extends null
        ? never
        : NonNullable<typeof pendingResolution>['strategy']
    ) => {
      if (!activeBlock || !session) return
      const wasAlreadyResolved = activeBlock.isResolved
      try {
        const result = await mergeFlowAPI.resolveConflict(
          repoRoot,
          activeBlock.blockId,
          resolvedText,
          strategy,
          wasAlreadyResolved ? (activeBlock.resolvedText ?? undefined) : undefined,
          activeBlock.originalConflictText
        )
        if ('error' in result) {
          addToast({ type: 'error', message: `Could not resolve conflict: ${result.error}` })
          return
        }
        confirmDecision(activeBlock.blockId, {
          blockId: activeBlock.blockId,
          resolvedText,
          strategy,
        })
        // Read the session AFTER confirmDecision so resolvedText is included in the persisted data
        const currentSession = useMergeFlowStore.getState().session
        if (!currentSession) return
        void mergeFlowAPI.persistSession(repoRoot, currentSession)
        if (!wasAlreadyResolved && currentSession.totalResolved >= currentSession.totalConflicts) {
          onComplete()
        } else if (!wasAlreadyResolved) {
          goToNextBlock()
        }
        // If re-resolving an already-resolved block, stay on it so the user
        // can continue reviewing — setPendingResolution will be cleared below
        setPendingResolution(null)
      } catch (e) {
        addToast({ type: 'error', message: `Could not resolve conflict: ${String(e)}` })
      }
    },
    [activeBlock, session, repoRoot, confirmDecision, goToNextBlock, onComplete, addToast]
  )

  const handleUndo = useCallback(async () => {
    const decision = undoLastDecision()
    if (!decision) return
    try {
      const result = await mergeFlowAPI.undoResolve(
        repoRoot,
        decision.blockId,
        decision.resolvedText,
        decision.originalConflictText
      )
      if ('error' in result) {
        addToast({ type: 'error', message: `Could not undo: ${result.error}` })
      }
    } catch (e) {
      addToast({ type: 'error', message: `Could not undo: ${String(e)}` })
    }
  }, [undoLastDecision, repoRoot, addToast])

  useEffect(() => {
    const noModal = !isKeepBothOpen && !manualMode
    if (!noModal) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') goToNextBlock()
      else if (e.key === 'ArrowLeft') goToPrevBlock()
      else if (e.key === 'm' || e.key === 'M')
        setPendingResolution({ text: activeBlock?.oursText ?? '', strategy: 'ours' })
      else if (e.key === 't' || e.key === 'T')
        setPendingResolution({ text: activeBlock?.theirsText ?? '', strategy: 'theirs' })
      else if (e.key === 'b' || e.key === 'B') openKeepBoth()
      else if (e.key === 'e' || e.key === 'E') setManualMode(true)
      else if (e.key === 'Enter' && pendingResolution)
        void handleResolve(pendingResolution.text, pendingResolution.strategy)
      else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'z') void handleUndo()
      else if (e.key === 'Escape') closeKeepBoth()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    isKeepBothOpen,
    manualMode,
    activeBlock,
    pendingResolution,
    goToNextBlock,
    goToPrevBlock,
    openKeepBoth,
    closeKeepBoth,
    handleResolve,
    handleUndo,
  ])

  if (!session || !activeFile || !activeBlock) return null

  const canPrev = activeFileIndex > 0 || activeBlockIndex > 0
  const canNext = (() => {
    const lastFileIdx = session.files.length - 1
    if (activeFileIndex < lastFileIdx) return true
    const lastBlockIdx = (session.files[lastFileIdx]?.blocks.length ?? 1) - 1
    return activeBlockIndex < lastBlockIdx
  })()

  return (
    <div className="conflict-resolver">
      <ConflictHeader
        onBack={onBack}
        onUndo={handleUndo}
        canUndo={undoStackLength > 0}
        onPrev={goToPrevBlock}
        onNext={goToNextBlock}
        canPrev={canPrev}
        canNext={canNext}
        onStartOver={onStartOver}
        onExit={onExit}
      />
      {activeFile.conflictDescription && (
        <div className="conflict-resolver__desc-banner">{activeFile.conflictDescription}</div>
      )}
      {manualMode ? (
        <ManualEditor
          block={activeBlock}
          suggestedText={manualSuggestedText}
          onSave={(text) => {
            setManualMode(false)
            setManualSuggestedText(null)
            void handleResolve(text, 'manual')
          }}
          onCancel={() => {
            setManualMode(false)
            setManualSuggestedText(null)
          }}
        />
      ) : (
        <ConflictPanel
          block={activeBlock}
          isRebase={session.isRebase}
          pendingStrategy={pendingResolution?.strategy ?? null}
          oursAuthor={activeFile.oursAuthor}
          theirsAuthor={activeFile.theirsAuthor}
          onSelectMine={() =>
            setPendingResolution({ text: activeBlock.oursText, strategy: 'ours' })
          }
          onSelectTheirs={() =>
            setPendingResolution({ text: activeBlock.theirsText, strategy: 'theirs' })
          }
        />
      )}
      <ResultPreviewStrip
        resolvedText={pendingResolution?.text ?? activeBlock.resolvedText ?? null}
        blockId={activeBlock.blockId}
        isExistingResolution={!pendingResolution && activeBlock.isResolved}
      />
      <ActionBar
        pendingResolution={pendingResolution}
        onKeepMine={() => {
          if (manualMode) {
            setManualSuggestedText(stripConflictMarkers(activeBlock.oursText))
          } else {
            setPendingResolution({ text: activeBlock.oursText, strategy: 'ours' })
          }
        }}
        onKeepTheirs={() => {
          if (manualMode) {
            setManualSuggestedText(stripConflictMarkers(activeBlock.theirsText))
          } else {
            setPendingResolution({ text: activeBlock.theirsText, strategy: 'theirs' })
          }
        }}
        onKeepBoth={openKeepBoth}
        onEdit={() => setManualMode(true)}
        onConfirm={() =>
          pendingResolution &&
          void handleResolve(pendingResolution.text, pendingResolution.strategy)
        }
      />
      {isKeepBothOpen && (
        <KeepBothModal
          block={activeBlock}
          oursAuthor={activeFile.oursAuthor}
          theirsAuthor={activeFile.theirsAuthor}
          oursBranch={session.oursBranch}
          theirsBranch={session.theirsBranch}
          onConfirm={(text, strategy) => {
            closeKeepBoth()
            void handleResolve(text, strategy)
          }}
          onCancel={closeKeepBoth}
        />
      )}
    </div>
  )
}
