import React, { useEffect, useRef, useState } from 'react'
import { CornerDownLeft, MessagesSquare, Paperclip, Pencil, Quote, Square, X } from 'lucide-react'
import { Button, Chip, IconButton } from '@terminator/extension-ui'
import { useFollowUpQueue } from './use-agent-transcript'
import { recordUse } from '../../usage/record'
import {
  hasAttachedContext,
  promptWithContext,
  splitAttachedContext,
  type AttachedContext,
  type Citation,
  type SessionContext,
} from './attached-context'
import { SESSION_DRAG_TYPE } from './session-drag'
import {
  attachSessions,
  attachedOf,
  useAttachedContextStore,
} from '../../stores/attached-context.store'
import { useTabDragStore } from '../../terminal/tab-drag'
import { CitationCommentPopover } from './cite'
import { readBase64 } from '../../../../core-shared/src/read-base64'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

interface Attachment {
  name: string
  size: number
  mimeType: string
  /** Base64 without the data URL prefix. */
  data: string
}

/** Why a file cannot go to the agent, in plain words; null when it can. */
function imageProblem(file: File): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return `${file.name} is not a PNG, JPEG, GIF or WebP image.`
  if (file.size > MAX_IMAGE_BYTES) return `${file.name} is larger than 5 MB.`
  return null
}

function useAttachments() {
  const [images, setImages] = useState<Attachment[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const add = async (files: File[]): Promise<void> => {
    setProblem(files.map(imageProblem).find((p) => p !== null) ?? null)
    const accepted = files.filter((file) => imageProblem(file) === null)
    if (accepted.length === 0) return
    recordUse('core.agent.attach', 'click')
    const read = await Promise.all(
      accepted.map(async ({ name, size, type }, i) => ({
        name,
        size,
        mimeType: type,
        data: await readBase64(accepted[i]),
      }))
    )
    setImages((current) => [...current, ...read])
  }
  const remove = (index: number): void => setImages((c) => c.filter((_, i) => i !== index))
  return { images, problem, add, remove, clear: () => setImages([]) }
}

const imagesOf = (files: FileList | null): File[] =>
  Array.from(files ?? []).filter((file) => file.type.startsWith('image/'))

const isSessionDrag = (e: React.DragEvent): boolean =>
  e.dataTransfer.types.includes(SESSION_DRAG_TYPE)

const CHIP_QUOTE_CHARS = 40

const cutQuote = (quote: string): string =>
  quote.length > CHIP_QUOTE_CHARS ? `${quote.slice(0, CHIP_QUOTE_CHARS)}…` : quote

/** The typed text of a queued message, and how many attached items went with it. */
function queuedLabel(message: string): string {
  const { text, attached } = splitAttachedContext(message)
  const count = attached.sessions.length + attached.citations.length
  return count === 0 ? text : `${text} · ${count} attached`
}

function QueueList(props: {
  messages: string[]
  onEdit: (index: number) => void
  onRemove: (index: number) => void
}): React.JSX.Element | null {
  const { messages } = props
  if (messages.length === 0) return null
  const many = messages.length !== 1
  return (
    <div className="agent-queue">
      <p className="agent-queue__title">
        {`${messages.length} message${many ? 's' : ''} send${many ? '' : 's'} when this turn ends`}
      </p>
      <ul>
        {messages.map((message, i) => {
          const { text } = splitAttachedContext(message)
          return (
            <li key={i} className="agent-queue__item">
              <span className="agent-queue__text">{queuedLabel(message)}</span>
              <IconButton icon={Pencil} label={`Edit ${text}`} onClick={() => props.onEdit(i)} />
              <IconButton icon={X} label={`Remove ${text}`} onClick={() => props.onRemove(i)} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const SOURCE_KIND = { agent: 'agent transcript', terminal: 'terminal output' } as const

const sourceKind = ({ source }: SessionContext): string =>
  source.kind === 'transcript' ? 'session' : SOURCE_KIND[source.origin]

/** A session sent, or to be sent, as context; removable while it waits in the composer. */
export function SessionChip(props: { context: SessionContext; onRemove?: () => void }) {
  const { context, onRemove } = props
  return (
    <li className="agent-context-chip">
      <Chip icon={<MessagesSquare aria-hidden />}>
        {context.title}
        <span className="agent-context-chip__meta">{sourceKind(context)}</span>
        {onRemove && (
          <IconButton icon={X} size="sm" label={`Remove ${context.title}`} onClick={onRemove} />
        )}
      </Chip>
    </li>
  )
}

type SaveComment = (comment: string, send: boolean) => void

function EditComment(props: { citation: Citation; onSave: SaveComment }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const open = (e: React.MouseEvent<HTMLButtonElement>): void => {
    const { left, bottom } = e.currentTarget.getBoundingClientRect()
    setAt({ x: left, y: bottom })
  }
  const save: SaveComment = (comment, send) => {
    props.onSave(comment, send)
    setAt(null)
  }
  const { quote, comment } = props.citation
  return (
    <>
      <IconButton icon={Pencil} size="sm" label="Edit comment" onClick={open} />
      {at && (
        <CitationCommentPopover
          {...{ quote, comment, at }}
          onSave={save}
          onClose={() => setAt(null)}
        />
      )}
    </>
  )
}

/** A citation; its comment can be edited and the citation removed while it waits in the composer. */
export function CitationChip(props: {
  citation: Citation
  onShowSource: (quote: string) => void
  onEdit?: SaveComment
  onRemove?: () => void
}) {
  const { citation, onEdit, onRemove } = props
  const { quote, comment } = citation
  return (
    <li className="agent-context-chip agent-context-chip--citation">
      <Button variant="ghost" size="sm" icon={Quote} onClick={() => props.onShowSource(quote)}>
        {cutQuote(quote)}
        {comment && <span className="agent-context-chip__meta">{comment}</span>}
      </Button>
      {onEdit && <EditComment citation={citation} onSave={onEdit} />}
      {onRemove && <IconButton icon={X} size="sm" label="Remove citation" onClick={onRemove} />}
    </li>
  )
}

const editCitation =
  (tabId: string, index: number): SaveComment =>
  (comment, send) => {
    const { updateCitation, requestSend } = useAttachedContextStore.getState()
    updateCitation(tabId, index, comment)
    if (send) requestSend(tabId)
  }

function ContextChips(props: { sessionId: string; onShowSource: (quote: string) => void }) {
  const { sessionId } = props
  const attached = useAttachedContextStore(attachedOf(sessionId))
  const { removeSession, removeCitation } = useAttachedContextStore.getState()
  return (
    <>
      {attached.sessions.map((context) => (
        <SessionChip
          key={context.sessionId}
          context={context}
          onRemove={() => removeSession(sessionId, context.sessionId)}
        />
      ))}
      {attached.citations.map((citation, i) => (
        <CitationChip
          key={i}
          citation={citation}
          onShowSource={props.onShowSource}
          onEdit={editCitation(sessionId, i)}
          onRemove={() => removeCitation(sessionId, i)}
        />
      ))}
    </>
  )
}

function Attachments(props: { attachments: AttachmentState; children: React.ReactNode }) {
  const { images, problem, remove } = props.attachments
  return (
    <>
      {problem && (
        <p role="alert" className="agent-composer__problem">
          {problem}
        </p>
      )}
      <ul className="agent-attachments">
        {images.map((image, i) => (
          <li key={i} className="agent-attachment">
            <img
              alt=""
              className="agent-attachment__thumb"
              src={`data:${image.mimeType};base64,${image.data}`}
            />
            <span className="agent-attachment__name">{image.name}</span>
            <span className="agent-attachment__size">{Math.ceil(image.size / 1024)} KB</span>
            <IconButton icon={X} label={`Remove ${image.name}`} onClick={() => remove(i)} />
          </li>
        ))}
        {props.children}
      </ul>
    </>
  )
}

interface ComposerProps {
  sessionId: string
  disabled: boolean
  running: boolean
  /** Finds a citation's quote in the transcript. */
  onShowSource: (quote: string) => void
}

type AttachmentState = ReturnType<typeof useAttachments>

interface Draft {
  text: string
  set: (text: string) => void
  attached: AttachedContext
  addAttached: (attached: AttachedContext) => void
}

/** What Enter does: send the prompt, or during a turn queue it (steer with Cmd or Ctrl). */
function useSender(
  { sessionId, running }: ComposerProps,
  attachments: AttachmentState,
  draft: Draft
) {
  const [queue, setQueue] = useFollowUpQueue(sessionId)
  const api = window.electronAPI.agents
  const prompt = (text: string): void => {
    const sent = attachments.images.map(({ mimeType, data }) => ({ mimeType, data }))
    void api.prompt({ sessionId, text, ...(sent.length > 0 && { images: sent }) })
    attachments.clear()
  }
  const send = (text: string, steer: boolean): void => {
    useAttachedContextStore.getState().clear(sessionId)
    if (!running) return prompt(text)
    if (steer) {
      recordUse('core.agent.steer', 'shortcut')
      void api.steer({ sessionId, text })
    } else {
      recordUse('core.agent.queue', 'shortcut')
      setQueue([...queue, text])
    }
  }
  return { queue, ...draftActions(draft, send, { queue, setQueue }) }
}

function draftActions(
  draft: Draft,
  send: (text: string, steer: boolean) => void,
  { queue, setQueue }: { queue: string[]; setQueue: (messages: string[]) => void }
) {
  const submit = (steer: boolean): void => {
    const text = draft.text.trim()
    if (!text && !hasAttachedContext(draft.attached)) return
    draft.set('')
    send(promptWithContext(text, draft.attached), steer)
  }
  const remove = (index: number): void => setQueue(queue.filter((_, i) => i !== index))
  const edit = (index: number): void => {
    const { text, attached } = splitAttachedContext(queue[index])
    draft.set(text)
    draft.addAttached(attached)
    remove(index)
  }
  return { submit, remove, edit }
}

function AttachButton(props: { disabled: boolean; onFiles: (files: File[]) => void }) {
  const fileInput = useRef<HTMLInputElement>(null)
  return (
    <>
      <IconButton
        icon={Paperclip}
        label="Add an image"
        disabled={props.disabled}
        onClick={() => fileInput.current?.click()}
      />
      <input
        ref={fileInput}
        type="file"
        hidden
        multiple
        aria-label="Attach an image"
        accept={IMAGE_TYPES.join(',')}
        onChange={(e) => {
          props.onFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
    </>
  )
}

function TurnButtons(props: { onSteer: () => void; onStop: () => void }) {
  return (
    <>
      <Button icon={CornerDownLeft} onClick={props.onSteer}>
        Steer
      </Button>
      <Button icon={Square} onClick={props.onStop}>
        Stop
      </Button>
    </>
  )
}

/** Enter sends and Shift+Enter stays a newline; Cmd or Ctrl asks to steer. */
function submitOnEnter(e: React.KeyboardEvent, submit: (steer: boolean) => void): void {
  if (e.key !== 'Enter' || e.shiftKey) return
  e.preventDefault()
  submit(e.metaKey || e.ctrlKey)
}

function ComposerInput(props: {
  draft: Draft
  disabled: boolean
  onSubmit: (steer: boolean) => void
  onFiles: (files: File[]) => void
}): React.JSX.Element {
  const { onFiles } = props
  return (
    <textarea
      aria-label="Message the agent"
      className="agent-composer__input"
      rows={2}
      value={props.draft.text}
      disabled={props.disabled}
      onChange={(e) => props.draft.set(e.target.value)}
      onKeyDown={(e) => submitOnEnter(e, props.onSubmit)}
      onPaste={(e) => onFiles(imagesOf(e.clipboardData.files))}
      onDrop={(e) => {
        if (isSessionDrag(e)) return
        e.preventDefault()
        onFiles(imagesOf(e.dataTransfer.files))
      }}
      onDragOver={(e) => !isSessionDrag(e) && e.preventDefault()}
    />
  )
}

/** The composer takes sessions dragged from the sidebar, Home, or the tab bar as context. */
function useContextDrop(sessionId: string) {
  const [dragOver, setDragOver] = useState(false)
  const tabOver = useTabDragStore(
    (s) => s.overContextDrop === sessionId && s.sessionId !== sessionId
  )
  const handlers = {
    onDragOver: (e: React.DragEvent) => {
      if (!isSessionDrag(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setDragOver(true)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false)
    },
    onDrop: (e: React.DragEvent) => {
      if (!isSessionDrag(e)) return
      e.preventDefault()
      setDragOver(false)
      void attachSessions(sessionId, e.dataTransfer.getData(SESSION_DRAG_TYPE).split('\n'))
    },
  }
  return { dropping: dragOver || tabOver, handlers }
}

function ContextDropZone(props: { sessionId: string; children: React.ReactNode }) {
  const { dropping, handlers } = useContextDrop(props.sessionId)
  return (
    <div
      className={`agent-composer${dropping ? ' agent-composer--drop' : ''}`}
      role="group"
      aria-label="Message composer"
      data-context-drop={props.sessionId}
      {...handlers}
    >
      {dropping && (
        <div className="agent-composer__drop">
          <MessagesSquare aria-hidden />
          Drop to attach this session as context
        </div>
      )}
      {props.children}
    </div>
  )
}

function useDraft(sessionId: string): Draft {
  const [text, set] = useState('')
  const attached = useAttachedContextStore(attachedOf(sessionId))
  const addAttached = (more: AttachedContext): void => {
    const store = useAttachedContextStore.getState()
    store.addSessions(sessionId, more.sessions)
    more.citations.forEach((citation) => store.addCitation(sessionId, citation))
  }
  return { text, set, attached, addAttached }
}

/** Sends the draft, as Enter would, each time something outside asks this tab to send now. */
function useSendRequests(sessionId: string, submit: (steer: boolean) => void, disabled: boolean) {
  const requests = useAttachedContextStore((s) => s.sendRequests.get(sessionId) ?? 0)
  const handled = useRef(requests)
  useEffect(() => {
    if (requests === handled.current) return
    handled.current = requests
    if (!disabled) submit(false)
  })
}

export function Composer(props: ComposerProps): React.JSX.Element {
  const { sessionId, disabled, running } = props
  const draft = useDraft(sessionId)
  const attachments = useAttachments()
  const { queue, submit, remove, edit } = useSender(props, attachments, draft)
  useSendRequests(sessionId, submit, disabled)
  const takeFiles = (files: File[]): void => void attachments.add(files)
  return (
    <ContextDropZone sessionId={sessionId}>
      <QueueList messages={queue} onEdit={edit} onRemove={remove} />
      <Attachments attachments={attachments}>
        <ContextChips sessionId={sessionId} onShowSource={props.onShowSource} />
      </Attachments>
      <div className="agent-composer__row">
        <ComposerInput draft={draft} disabled={disabled} onSubmit={submit} onFiles={takeFiles} />
        <AttachButton disabled={disabled} onFiles={takeFiles} />
        {running && !disabled && (
          <TurnButtons
            onSteer={() => submit(true)}
            onStop={() => void window.electronAPI.agents.cancel({ sessionId })}
          />
        )}
      </div>
      {running && <p className="agent-composer__hint">↵ queue · ⌘↵ steer now</p>}
    </ContextDropZone>
  )
}
