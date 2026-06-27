import React, { useEffect, useRef, useState } from 'react'
import { useModalEffect } from '../stores/modal.store'
import './sidebar/Dialog.css'

interface Props {
  defaultName: string
  onConfirm: (name: string) => void
  onCancel: () => void
}

export function NameTerminalDialog({ defaultName, onConfirm, onCancel }: Props) {
  useModalEffect()
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onCancel])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onConfirm(name.trim())
  }

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <form
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-terminal-title"
      >
        <div id="name-terminal-title" className="dialog__title">
          Name this terminal
        </div>
        <input
          ref={inputRef}
          type="text"
          className="settings-section__input"
          placeholder={defaultName}
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ margin: '8px 0 16px', width: '100%' }}
        />
        <div className="dialog__actions">
          <button type="button" className="dialog__btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="dialog__btn-primary">
            Open
          </button>
        </div>
      </form>
    </div>
  )
}
