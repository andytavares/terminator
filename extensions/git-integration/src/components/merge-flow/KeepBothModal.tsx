import React, { useState, useMemo } from 'react'
import { ArrowDown, TriangleAlert } from 'lucide-react'
import { Dialog, RelativeTime, SegmentedControl } from '@terminator/extension-ui'
import type { ConflictBlock, GitAuthor } from '../../schemas/merge-flow.schema'
import { highlightBlock, langFromBlockId } from '../../utils/syntax'
import { plural } from '@terminator/extension-sdk'
import { choose } from '../text'

interface Props {
  block: ConflictBlock
  oursAuthor?: GitAuthor
  theirsAuthor?: GitAuthor
  oursBranch?: string
  theirsBranch?: string
  onConfirm: (text: string, strategy: 'both-ours-first' | 'both-theirs-first') => void
  onCancel: () => void
}

const IDENTIFIER_RE = /\b(?:function|class|const|let|var)\s+(\w+)/g

function extractIdentifiers(text: string): Set<string> {
  const ids = new Set<string>()
  let m: RegExpExecArray | null
  IDENTIFIER_RE.lastIndex = 0
  while ((m = IDENTIFIER_RE.exec(text)) !== null) {
    ids.add(m[1])
  }
  return ids
}

function hasDuplicateIdentifiers(a: string, b: string): boolean {
  const aIds = extractIdentifiers(a)
  const bIds = extractIdentifiers(b)
  for (const id of aIds) {
    if (bIds.has(id)) return true
  }
  return false
}

const PREVIEW_LINES = 5

type Order = 'ours-first' | 'theirs-first'
type Slot = 'first' | 'second'

const ORDER_OPTIONS = [
  { value: 'ours-first', label: 'Mine first' },
  { value: 'theirs-first', label: 'Theirs first' },
] as const

/** Highlighted code beside its line numbers, counted from `startLine`. */
function NumberedCode(props: { lineCount: number; startLine: number; html: string }) {
  const numbers = Array.from({ length: props.lineCount }, (_, i) => props.startLine + i)
  return (
    <div className="keep-both-modal__code-inner">
      <div className="keep-both-modal__line-nums" aria-hidden="true">
        {numbers.map((n) => (
          <span key={n}>{n}</span>
        ))}
      </div>
      <code dangerouslySetInnerHTML={{ __html: props.html }} />
    </div>
  )
}

function CodePreview(props: { code: string; lang?: string; startLine?: number }) {
  const lines = props.code.split('\n')
  const shown = lines.slice(0, PREVIEW_LINES)
  const overflow = lines.length - PREVIEW_LINES
  const html = highlightBlock(shown.join('\n'), props.lang)
  return (
    <div className="keep-both-modal__code-preview">
      <pre className="keep-both-modal__code-pre hljs">
        <NumberedCode lineCount={shown.length} startLine={props.startLine ?? 1} html={html} />
      </pre>
      {overflow > 0 && (
        <div className="keep-both-modal__overflow">
          ... ({overflow} more {plural(overflow, 'line')})
        </div>
      )}
    </div>
  )
}

function AuthorTime({ timestamp }: { timestamp: string }) {
  const [openedAt] = useState(() => Date.now())
  return (
    <span className="keep-both-modal__timestamp">
      <RelativeTime value={timestamp} now={openedAt} />
    </span>
  )
}

function AuthorHeader(props: { author?: GitAuthor; branch?: string }) {
  const author: Partial<GitAuthor> = props.author ?? {}
  const { name, timestamp } = author
  const hash = author.commitHash?.slice(0, 7)
  return (
    <div className="keep-both-modal__author-row">
      <span className="keep-both-modal__drag-handle">⠿</span>
      {props.branch && <span className="keep-both-modal__branch-tag">{props.branch}</span>}
      {name && <span className="keep-both-modal__author-name">{name}</span>}
      {hash && <span className="keep-both-modal__commit-hash">{hash}</span>}
      {timestamp && <AuthorTime timestamp={timestamp} />}
    </div>
  )
}

interface Side {
  id: 'ours' | 'theirs'
  text: string
  author?: GitAuthor
  branch?: string
  label: string
}

function keepBothSides(props: Props): { ours: Side; theirs: Side } {
  const { block } = props
  return {
    ours: {
      id: 'ours',
      text: block.oursText,
      author: props.oursAuthor,
      branch: props.oursBranch,
      label: 'Yours',
    },
    theirs: {
      id: 'theirs',
      text: block.theirsText,
      author: props.theirsAuthor,
      branch: props.theirsBranch,
      label: 'Theirs',
    },
  }
}

/** The two sides in the chosen order. */
function orderedSides(props: Props, order: Order): [Side, Side] {
  const { ours, theirs } = keepBothSides(props)
  if (order === 'ours-first') return [ours, theirs]
  return [theirs, ours]
}

/** "Ana's change (Yours)", or just the label when the author is unknown. */
function sideName(side: Side): string {
  if (!side.author?.name) return side.label
  return `${side.author.name}'s change (${side.label})`
}

function flipped(order: Order): Order {
  return choose<Order>(order === 'ours-first', 'theirs-first', 'ours-first')
}

/** Drag either block onto the other to swap the order. */
function useBlockDrag(setOrder: (update: (o: Order) => Order) => void) {
  const [dragOver, setDragOver] = useState<Slot | null>(null)
  const slotDragHandlers = (slot: Slot) => ({
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData('text/plain', slot)
      e.dataTransfer.effectAllowed = 'move'
    },
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDragOver(slot)
    },
    onDragLeave: () => setDragOver(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(null)
      if (e.dataTransfer.getData('text/plain') !== slot) setOrder(flipped)
    },
  })
  return { dragOver, handlersFor: slotDragHandlers }
}

type BlockDrag = ReturnType<typeof useBlockDrag>

interface BlockRowProps {
  slot: Slot
  num: number
  side: Side
  lang: string | undefined
  drag: BlockDrag
}

function BlockRow(props: BlockRowProps) {
  const { slot, side, drag } = props
  const over = choose(drag.dragOver === slot, ' keep-both-modal__block-row--drag-over', '')
  const handlers = drag.handlersFor(slot)
  return (
    <div className={`keep-both-modal__block-row${over}`} draggable {...handlers}>
      <div className="keep-both-modal__block-label">
        <span className="keep-both-modal__block-num">{props.num}</span>
        <span className="keep-both-modal__block-title">{sideName(side)}</span>
        <span className="keep-both-modal__drag-hint" title="Drag to reorder">
          ⠿ drag
        </span>
      </div>
      <div className="keep-both-modal__block-card">
        <AuthorHeader author={side.author} branch={side.branch} />
        <CodePreview code={side.text} lang={props.lang} startLine={1} />
      </div>
    </div>
  )
}

function MergedPreview(props: { preview: string; lang: string | undefined }) {
  const lineCount = props.preview.split('\n').length
  return (
    <div className="keep-both-modal__preview-section">
      <div className="keep-both-modal__preview-label">
        <ArrowDown aria-hidden="true" /> Merged result preview
      </div>
      <pre className="keep-both-modal__preview hljs">
        <NumberedCode
          lineCount={lineCount}
          startLine={1}
          html={highlightBlock(props.preview, props.lang)}
        />
      </pre>
    </div>
  )
}

function ThenDivider() {
  return (
    <div className="keep-both-modal__then">
      <span className="keep-both-modal__then-line" />
      <span className="keep-both-modal__then-label">then</span>
      <span className="keep-both-modal__then-line" />
    </div>
  )
}

function DuplicateWarning() {
  return (
    <div className="keep-both-modal__warning" role="alert">
      <TriangleAlert aria-hidden="true" /> This will produce a duplicate identifier. Consider using
      &quot;Edit manually&quot; to combine them.
    </div>
  )
}

function strategyOf(order: Order): 'both-ours-first' | 'both-theirs-first' {
  return choose(order === 'ours-first', 'both-ours-first' as const, 'both-theirs-first' as const)
}

function OrderedBlocks(props: { sides: [Side, Side]; lang: string | undefined; drag: BlockDrag }) {
  const { sides, lang, drag } = props
  return (
    <>
      <BlockRow slot="first" num={1} side={sides[0]} lang={lang} drag={drag} />
      <ThenDivider />
      <BlockRow slot="second" num={2} side={sides[1]} lang={lang} drag={drag} />
    </>
  )
}

/** True when both sides declare the same name, so keeping both would not compile. */
function useDuplicateWarning(block: ConflictBlock): boolean {
  return useMemo(
    () => hasDuplicateIdentifiers(block.oursText, block.theirsText),
    [block.oursText, block.theirsText]
  )
}

function OrderControls(props: { order: Order; setOrder: (order: Order) => void }) {
  return (
    <>
      <p className="keep-both-modal__subtitle">
        Drag blocks to reorder, or use the toggle buttons.
      </p>
      <SegmentedControl
        label="Order"
        options={[...ORDER_OPTIONS]}
        value={props.order}
        onChange={props.setOrder}
      />
    </>
  )
}

function keepBothActions(onCancel: () => void, onConfirm: () => void) {
  return [
    { label: 'Cancel', onSelect: onCancel },
    { label: 'Use this order', tone: 'primary' as const, onSelect: onConfirm },
  ]
}

export function KeepBothModal(props: Props) {
  const { block, onCancel } = props
  const [order, setOrder] = useState<Order>('ours-first')
  const drag = useBlockDrag(setOrder)
  const lang = langFromBlockId(block.blockId)
  const [first, second] = orderedSides(props, order)
  const preview = `${first.text}\n${second.text}`
  const showDuplicateWarning = useDuplicateWarning(block)
  const confirmOrder = () => props.onConfirm(preview, strategyOf(order))
  return (
    <Dialog
      title="Keep both changes — choose order"
      onDismiss={onCancel}
      actions={keepBothActions(onCancel, confirmOrder)}
    >
      <OrderControls order={order} setOrder={setOrder} />
      <OrderedBlocks sides={[first, second]} lang={lang} drag={drag} />
      <MergedPreview preview={preview} lang={lang} />
      {showDuplicateWarning && <DuplicateWarning />}
    </Dialog>
  )
}
