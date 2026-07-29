import React, { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCorners,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { STAGE_ORDER } from '../types/speckit.types.js'
import type { BoardStage, CardSummary } from '../types/speckit.types.js'
import { getSpeckitAPI, type PendingAskView } from '../types/electron.js'
import { PermissionQueue } from './PermissionQueue.js'
import { SupervisionPanel } from './SupervisionPanel.js'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { CardTile } from './CardTile.js'
import { bucketCards, resolveDrop } from './board-util.js'

const STAGE_LABEL: Record<BoardStage, string> = {
  backlog: 'Backlog',
  'in-progress': 'In Progress',
  'in-review': 'In Review',
  done: 'Done',
}

function DraggableCard({ card, onOpen }: { card: CardSummary; onOpen: (dir: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.featureDir })
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} style={{ opacity: isDragging ? 0.4 : 1 }}>
      <CardTile card={card} onOpen={onOpen} />
    </div>
  )
}

function Column({
  stage,
  cards,
  onOpen,
}: {
  stage: BoardStage
  cards: CardSummary[]
  onOpen: (dir: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage })
  return (
    <section
      ref={setNodeRef}
      data-testid={`board-column-${stage}`}
      className={`sk-board-col${isOver ? ' sk-board-col--over' : ''}`}
    >
      <header className="sk-board-col__head">
        {STAGE_LABEL[stage]} <span className="sk-board-col__count">{cards.length}</span>
      </header>
      <div className="sk-board-col__body">
        {cards.length === 0 ? (
          <p className="sk-board-col__empty">No cards</p>
        ) : (
          cards.map((c) => <DraggableCard key={c.featureDir} card={c} onOpen={onOpen} />)
        )}
      </div>
    </section>
  )
}

interface BoardViewProps {
  repoRoot: string
  onOpenCard: (featureDir: string) => void
  onNewCard: () => void
}

export function BoardView({ repoRoot, onOpenCard, onNewCard }: BoardViewProps) {
  const [cards, setCards] = useState<CardSummary[]>([])
  // What supervised runs are holding. Above the board rather than inside a
  // card: a held tool call is the one state where nothing moves until a person
  // acts, and finding it would mean opening cards one at a time.
  const [pending, setPending] = useState<PendingAskView[]>([])
  const [error, setError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  // Going to a run's terminal is a core navigation, so it is done through the
  // core stores rather than reimplemented here.
  const sessions = useSessionStore((s) => s.sessions)
  const setActiveSessionForProject = useSessionStore((s) => s.setActiveSessionForProject)
  const setActiveProject = useWorkspaceStore((s) => s.setActiveProject)
  // Where the palette last asked to go, so the panel opens on it.
  const [focus, setFocus] = useState<{ kind: 'run' | 'review'; sessionId: string } | null>(null)
  // Require an 8px drag before a pointer gesture counts as a drag, so a plain click
  // opens the card instead of being mistaken for a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  )

  const load = useCallback(async () => {
    if (!repoRoot) return
    const result = await getSpeckitAPI().cardList({ repoRoot })
    if ('cards' in result) setCards(result.cards)
    else setError(result.error)
  }, [repoRoot])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const unsub = getSpeckitAPI().onStateChanged(() => void load())
    return unsub
  }, [load])

  // The palette jumps here. A run goes to its terminal when it still has one;
  // otherwise, and for a queued diff, the supervision panel opens on it.
  useEffect(() => {
    return getSpeckitAPI().onPaletteGoto((goto) => {
      if (goto.kind === 'run' && goto.terminalSessionId !== null) {
        const session = sessions.get(goto.terminalSessionId)
        if (session !== undefined) {
          setActiveProject(session.projectId)
          setActiveSessionForProject(session.projectId, goto.terminalSessionId)
          return
        }
      }
      setFocus({ kind: goto.kind, sessionId: goto.sessionId })
    })
  }, [sessions, setActiveProject, setActiveSessionForProject])

  const loadPending = useCallback(async () => {
    const result = await getSpeckitAPI().permissionsList()
    setPending(result.pending)
  }, [])

  useEffect(() => {
    void loadPending()
    // Raised and cleared by the runtime rather than by anything on screen, so
    // the board is told rather than asked.
    return getSpeckitAPI().onPermissionsChanged(() => void loadPending())
  }, [loadPending])

  const answer = useCallback(
    async (call: Promise<unknown>) => {
      await call
      await loadPending()
    },
    [loadPending]
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }, [])

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveId(null)
      const overId = event.over?.id
      if (!overId) return
      const move = resolveDrop(cards, String(event.active.id), overId as BoardStage)
      if (!move) return
      const moved = cards.find((c) => c.featureDir === move.featureDir)
      const isRunning = moved?.runStatus === 'running' || moved?.runStatus === 'waiting'
      if (
        move.toStage === 'backlog' &&
        isRunning &&
        typeof window !== 'undefined' &&
        window.confirm &&
        !window.confirm('Park this card back to Backlog? Its in-progress run will be stopped.')
      ) {
        return
      }
      const result = await getSpeckitAPI().cardMove({
        featureDir: move.featureDir,
        workspacePath: repoRoot,
        toStage: move.toStage,
      })
      if ('error' in result) setError(result.message ?? result.error)
      else void load()
    },
    [cards, repoRoot, load]
  )

  const buckets = bucketCards(cards)
  const activeCard = activeId ? cards.find((c) => c.featureDir === activeId) : null

  return (
    <div className="sk-board">
      <div className="sk-board__toolbar">
        <button type="button" className="sk-btn sk-btn--primary" onClick={onNewCard}>
          <Plus size={14} /> New card
        </button>
        {error && (
          <span role="alert" className="sk-board__error">
            {error}
          </span>
        )}
      </div>
      {pending.length > 0 && (
        <PermissionQueue
          pending={pending}
          cardLabel={(featureDir) =>
            cards.find((card) => card.featureDir === featureDir)?.title ??
            featureDir.split('/').pop() ??
            featureDir
          }
          onAllow={(requestId) =>
            void answer(getSpeckitAPI().permissionResolve({ requestId, decision: 'allow' }))
          }
          onDeny={(requestId) =>
            void answer(getSpeckitAPI().permissionResolve({ requestId, decision: 'deny' }))
          }
          onAnswer={(requestId, text) =>
            void answer(
              getSpeckitAPI().permissionResolve({ requestId, decision: 'deny', answer: text })
            )
          }
          onHandBack={(requestId) => void answer(getSpeckitAPI().permissionHandBack({ requestId }))}
        />
      )}
      {/* Everything the supervision layer knows: what is running, what has
          stopped making progress, what is waiting to be reviewed, and what
          happened while you were away. */}
      <SupervisionPanel
        cardLabel={(featureDir) =>
          cards.find((card) => card.featureDir === featureDir)?.title ??
          featureDir.split('/').pop() ??
          featureDir
        }
        workspacePath={repoRoot}
        onOpenTerminal={(terminalSessionId) => {
          const session = sessions.get(terminalSessionId)
          if (session === undefined) return
          setActiveProject(session.projectId)
          setActiveSessionForProject(session.projectId, terminalSessionId)
        }}
        onChanged={() => void load()}
        focus={focus}
      />
      {cards.length === 0 ? (
        <div className="sk-board__empty">Create your first card to get started.</div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="sk-board__cols">
            {STAGE_ORDER.map((stage) => (
              <Column key={stage} stage={stage} cards={buckets[stage]} onOpen={onOpenCard} />
            ))}
          </div>
          <DragOverlay>
            {activeCard ? (
              <div className="sk-card-drag-overlay">
                <CardTile card={activeCard} onOpen={() => {}} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  )
}
