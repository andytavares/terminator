import React, { useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { CardBrief, CardType, ChecklistItem } from '../types/speckit.types.js'

const TYPES: CardType[] = ['feature', 'bug', 'chore', 'spike']

interface CardBriefEditorProps {
  initial?: Partial<CardBrief>
  submitLabel?: string
  onSubmit: (brief: {
    title: string
    type: CardType
    scope: string
    checklist: ChecklistItem[]
  }) => void
  onCancel?: () => void
}

export function CardBriefEditor({
  initial,
  submitLabel = 'Save',
  onSubmit,
  onCancel,
}: CardBriefEditorProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [type, setType] = useState<CardType>(initial?.type ?? 'feature')
  const [scope, setScope] = useState(initial?.scope ?? '')
  const [checklist, setChecklist] = useState<ChecklistItem[]>(initial?.checklist ?? [])
  const [newItem, setNewItem] = useState('')

  const titleEmpty = title.trim().length === 0

  function addItem() {
    if (newItem.trim().length === 0) return
    setChecklist((prev) => [
      ...prev,
      { id: `i-${Date.now()}-${prev.length}`, text: newItem.trim(), done: false },
    ])
    setNewItem('')
  }

  function submit() {
    if (titleEmpty) return
    onSubmit({ title: title.trim(), type, scope, checklist })
  }

  return (
    <div className="sk-brief-editor">
      <label className="sk-field">
        <span>Title</span>
        <input
          aria-label="Card title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
        />
      </label>

      <div className="sk-field">
        <span>Type</span>
        <div className="sk-segmented" role="radiogroup" aria-label="Card type">
          {TYPES.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              className={`sk-segmented__opt${type === t ? ' sk-segmented__opt--on' : ''}`}
              onClick={() => setType(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <label className="sk-field">
        <span>Scope</span>
        <textarea
          aria-label="Card scope"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          rows={3}
          placeholder="What is in and out of scope?"
        />
      </label>

      <div className="sk-field">
        <span>Checklist</span>
        <ul className="sk-checklist">
          {checklist.map((item) => (
            <li key={item.id}>
              <label>
                <input
                  type="checkbox"
                  checked={item.done}
                  aria-label={item.text}
                  onChange={() =>
                    setChecklist((prev) =>
                      prev.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i))
                    )
                  }
                />
                <span>{item.text}</span>
              </label>
              <button
                type="button"
                aria-label={`Remove ${item.text}`}
                onClick={() => setChecklist((prev) => prev.filter((i) => i.id !== item.id))}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
        <div className="sk-checklist__add">
          <input
            aria-label="New checklist item"
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addItem()
              }
            }}
            placeholder="Add an item"
          />
          <button type="button" aria-label="Add checklist item" onClick={addItem}>
            <Plus size={14} />
          </button>
        </div>
      </div>

      {titleEmpty && <p className="sk-field__hint">A title is required before saving.</p>}

      <div className="sk-brief-editor__actions">
        {onCancel && (
          <button type="button" className="sk-btn" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button
          type="button"
          className="sk-btn sk-btn--primary"
          disabled={titleEmpty}
          onClick={submit}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  )
}
