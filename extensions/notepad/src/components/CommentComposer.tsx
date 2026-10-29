import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Button } from '@terminator/extension-ui'
import { recordUsage } from '@terminator/extension-sdk/renderer'

interface CommentAnchorData {
  noteId: string
  from: number
  to: number
  quote: string
  prefix: string
  suffix: string
}

interface CommentComposerProps {
  anchor: CommentAnchorData
  onClose: () => void
  onCreated: (commentId: string) => void
}

export function CommentComposer(props: CommentComposerProps): React.JSX.Element {
  const { onClose } = props
  const { body, setBody, submitting, handleSubmit } = useCommentDraft(props)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  return (
    <div className="notepad-composer">
      <textarea
        ref={textareaRef}
        className="notepad-composer__body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        placeholder="Add a comment…"
        rows={3}
      />
      <AddCommentActions
        onClose={onClose}
        onSubmit={handleSubmit}
        canSubmit={!!body.trim() && !submitting}
      />
    </div>
  )
}

/** The comment being written, and submitting it on the anchored text. */
function useCommentDraft({ anchor, onCreated }: CommentComposerProps) {
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = useCallback(async () => {
    if (!body.trim()) return
    setSubmitting(true)
    try {
      const id = await createAnchoredComment(anchor, body.trim())
      if (id) {
        recordUsage('comment')
        onCreated(id)
      }
    } finally {
      setSubmitting(false)
    }
  }, [body, anchor, onCreated])

  return { body, setBody, submitting, handleSubmit }
}

/** Creates a comment on the anchored text; resolves to its id, if one came back. */
async function createAnchoredComment(anchor: CommentAnchorData, body: string) {
  const result = await window.electronAPI.extensionBridge.invoke(
    'terminator.notepad:comments.create',
    {
      noteId: anchor.noteId,
      body,
      startOffset: anchor.from,
      endOffset: anchor.to,
      quote: anchor.quote,
      prefix: anchor.prefix,
      suffix: anchor.suffix,
    }
  )
  return (result as { data?: { id: string } }).data?.id
}

interface ComposerActionsProps {
  onClose: () => void
  onSubmit: () => void
  canSubmit: boolean
}

function AddCommentActions(props: ComposerActionsProps): React.JSX.Element {
  const { onClose, onSubmit, canSubmit } = props
  return (
    <div className="notepad-composer__actions">
      <Button variant="ghost" size="sm" onClick={onClose}>
        Cancel
      </Button>
      <Button variant="primary" size="sm" onClick={onSubmit} disabled={!canSubmit}>
        Add comment
      </Button>
    </div>
  )
}
