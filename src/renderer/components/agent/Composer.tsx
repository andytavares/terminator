import React, { useRef, useState } from 'react'
import { CornerDownLeft, Paperclip, Pencil, Square, X } from 'lucide-react'
import { Button, IconButton } from '@terminator/extension-ui'
import { useFollowUpQueue } from './use-agent-transcript'
import { recordUse } from '../../usage/record'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

interface Attachment {
  name: string
  size: number
  mimeType: string
  /** Base64 without the data URL prefix. */
  data: string
}

const readBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

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
        {messages.map((message, i) => (
          <li key={i} className="agent-queue__item">
            <span className="agent-queue__text">{message}</span>
            <IconButton icon={Pencil} label={`Edit ${message}`} onClick={() => props.onEdit(i)} />
            <IconButton icon={X} label={`Remove ${message}`} onClick={() => props.onRemove(i)} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function Attachments(props: { attachments: AttachmentState }) {
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
      </ul>
    </>
  )
}

interface ComposerProps {
  sessionId: string
  disabled: boolean
  running: boolean
}

type AttachmentState = ReturnType<typeof useAttachments>

interface Draft {
  text: string
  set: (text: string) => void
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
    if (!text) return
    draft.set('')
    send(text, steer)
  }
  const remove = (index: number): void => setQueue(queue.filter((_, i) => i !== index))
  const edit = (index: number): void => {
    draft.set(queue[index])
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
        e.preventDefault()
        onFiles(imagesOf(e.dataTransfer.files))
      }}
      onDragOver={(e) => e.preventDefault()}
    />
  )
}

export function Composer(props: ComposerProps): React.JSX.Element {
  const { sessionId, disabled, running } = props
  const [text, set] = useState('')
  const draft = { text, set }
  const attachments = useAttachments()
  const { queue, submit, remove, edit } = useSender(props, attachments, draft)
  const takeFiles = (files: File[]): void => void attachments.add(files)
  return (
    <div className="agent-composer">
      <QueueList messages={queue} onEdit={edit} onRemove={remove} />
      <Attachments attachments={attachments} />
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
    </div>
  )
}
