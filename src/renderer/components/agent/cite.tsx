import React, { useEffect, useState } from 'react'
import { Quote } from 'lucide-react'
import { Button, Popover } from '@terminator/extension-ui'
import { recordUse } from '../../usage/record'
import { MAX_QUOTE_CHARS, type Citation } from './attached-context'
import { useAttachedContextStore } from '../../stores/attached-context.store'

export interface CiteTarget {
  quote: string
  entryIndex: number
  rect: DOMRect
}

type Point = { x: number; y: number }

const agentReplyOf = (node: Node | null): HTMLElement | null =>
  (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>(
    '.agent-message--agent[data-entry-index]'
  ) ?? null

/** The selection as a citation, when it lies inside one agent reply in `log`. */
function citeTargetOf(log: HTMLElement | null, selection: Selection | null): CiteTarget | null {
  if (!log || !selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const message = agentReplyOf(selection.anchorNode)
  if (!message || message !== agentReplyOf(selection.focusNode) || !log.contains(message))
    return null
  const quote = selection.toString().trim()
  if (!quote) return null
  const rect = selection.getRangeAt(0).getBoundingClientRect()
  return { quote, entryIndex: Number(message.dataset.entryIndex), rect }
}

export function useCiteSelection(logRef: React.RefObject<HTMLElement | null>): CiteTarget | null {
  const [target, setTarget] = useState<CiteTarget | null>(null)
  useEffect(() => {
    const update = (): void => setTarget(citeTargetOf(logRef.current, document.getSelection()))
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [logRef])
  return target
}

export function CiteButton(props: {
  target: CiteTarget
  onCite: () => void
  onDismiss: () => void
}): React.JSX.Element {
  const { rect, quote } = props.target
  const tooLong = quote.length > MAX_QUOTE_CHARS
  return (
    <Popover
      label="Cite the selection"
      className="agent-cite"
      at={{ x: rect.left + rect.width / 2, y: rect.top }}
      onDismiss={props.onDismiss}
    >
      {/* Pressing the button must not clear the selection it cites. */}
      <Button
        size="sm"
        icon={Quote}
        disabled={tooLong}
        onMouseDown={(e) => e.preventDefault()}
        onClick={props.onCite}
      >
        {tooLong ? 'Shorten the selection' : 'Cite'}
      </Button>
    </Popover>
  )
}

/** Enter saves, Cmd or Ctrl plus Enter saves and sends; Shift+Enter stays a newline. */
function saveOnEnter(e: React.KeyboardEvent, save: (send: boolean) => void): void {
  if (e.key !== 'Enter' || e.shiftKey) return
  e.preventDefault()
  save(e.metaKey || e.ctrlKey)
}

function CommentActions(props: { onSave: () => void; onCancel: () => void }) {
  return (
    <div className="agent-comment__row">
      <span className="agent-comment__hint">↵ save · ⌘↵ save and send</span>
      <Button onClick={props.onCancel}>Cancel</Button>
      <Button variant="primary" onClick={props.onSave}>
        Save
      </Button>
    </div>
  )
}

interface CitationCommentPopoverProps {
  quote: string
  at: Point
  comment?: string
  onSave: (comment: string, send: boolean) => void
  onClose: () => void
}

export function CitationCommentPopover(props: CitationCommentPopoverProps): React.JSX.Element {
  const [comment, setComment] = useState(props.comment ?? '')
  const save = (send: boolean): void => props.onSave(comment.trim(), send)
  return (
    <Popover
      label="Comment on a quote"
      className="agent-comment"
      at={props.at}
      onDismiss={props.onClose}
    >
      <p className="agent-comment__quote">
        <Quote aria-hidden />
        <span className="agent-comment__quote-text">{`“${props.quote}”`}</span>
      </p>
      <textarea
        autoFocus
        aria-label="Comment on this quote"
        className="agent-comment__input"
        rows={2}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={(e) => saveOnEnter(e, save)}
      />
      <CommentActions onSave={() => save(false)} onCancel={props.onClose} />
    </Popover>
  )
}

/** Puts the caret in the tab's composer, where the saved citation waits to be sent. */
function focusComposer(tabId: string): void {
  document
    .querySelector<HTMLTextAreaElement>(`[data-context-drop="${tabId}"] .agent-composer__input`)
    ?.focus()
}

function saveCitation(tabId: string, citation: Citation, send: boolean): void {
  const store = useAttachedContextStore.getState()
  store.addCitation(tabId, citation)
  recordUse('core.agent.cite', 'click')
  focusComposer(tabId)
  if (send) store.requestSend(tabId)
}

/** Cite, then comment on, a passage the operator selects in an agent reply. */
export function CiteLayer(props: {
  log: React.RefObject<HTMLElement | null>
  tabId: string
}): React.JSX.Element | null {
  const target = useCiteSelection(props.log)
  const [dismissed, setDismissed] = useState<CiteTarget | null>(null)
  const [commenting, setCommenting] = useState<CiteTarget | null>(null)
  if (commenting) {
    const { entryIndex, quote, rect } = commenting
    // The selection is handled: Cite stays hidden until the operator selects again.
    const close = (): void => {
      setDismissed(commenting)
      setCommenting(null)
    }
    const onSave = (comment: string, send: boolean): void => {
      saveCitation(props.tabId, { entryIndex, quote, comment }, send)
      close()
    }
    const at = { x: rect.left, y: rect.bottom }
    return <CitationCommentPopover quote={quote} at={at} onSave={onSave} onClose={close} />
  }
  if (!target || target === dismissed) return null
  return (
    <CiteButton
      target={target}
      onCite={() => setCommenting(target)}
      onDismiss={() => setDismissed(target)}
    />
  )
}
