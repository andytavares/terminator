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
import { getSpeckitAPI } from '../types/electron.js'
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
  const [error, setError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
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
