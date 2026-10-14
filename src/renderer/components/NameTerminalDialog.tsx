import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@terminator/extension-ui'
import { useModalEffect } from '../stores/modal.store'

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

  return (
    <Dialog
      title="Name this terminal"
      onDismiss={onCancel}
      actions={[
        { label: 'Cancel', onSelect: onCancel },
        { label: 'Open', tone: 'primary', submit: true, onSelect: () => onConfirm(name.trim()) },
      ]}
    >
      <input
        ref={inputRef}
        type="text"
        aria-label="Terminal name"
        placeholder={defaultName}
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{ width: '100%' }}
      />
    </Dialog>
  )
}
