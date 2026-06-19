import React, { useState, useCallback, useRef, useEffect } from 'react'

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

export function CommentComposer({
  anchor,
  onClose,
  onCreated,
}: CommentComposerProps): React.JSX.Element {
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!body.trim()) return
    setSubmitting(true)
    try {
      const result = await window.electronAPI.extensionBridge.invoke(
        'terminator.notepad:comments.create',
        {
          noteId: anchor.noteId,
          body: body.trim(),
          startOffset: anchor.from,
          endOffset: anchor.to,
          quote: anchor.quote,
          prefix: anchor.prefix,
          suffix: anchor.suffix,
        }
      )
      const data = (result as { data?: { id: string } }).data
      if (data?.id) onCreated(data.id)
    } finally {
      setSubmitting(false)
    }
  }, [body, anchor, onCreated])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose]
  )

  return (
    <div className="notepad-composer">
      <textarea
        ref={textareaRef}
        className="notepad-composer__body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add a comment…"
        rows={3}
      />
      <div className="notepad-composer__actions">
        <button className="notepad-composer__cancel" onClick={onClose} type="button">
          Cancel
        </button>
        <button
          className="notepad-composer__submit"
          onClick={handleSubmit}
          disabled={!body.trim() || submitting}
          type="button"
        >
          Add comment
        </button>
      </div>
    </div>
  )
}
