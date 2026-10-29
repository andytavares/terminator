import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@terminator/extension-ui'
import { recordUse } from '../usage/record'

interface Props {
  defaultName: string
  onConfirm: (name: string) => void
  onCancel: () => void
}

function saveName(name: string, onConfirm: (name: string) => void): void {
  if (name.trim() !== '') recordUse('core.terminal.rename')
  onConfirm(name.trim())
}

export function NameTerminalDialog({ defaultName, onConfirm, onCancel }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const save = (): void => saveName(name, onConfirm)
  return (
    <Dialog
      title="Name this terminal"
      onDismiss={onCancel}
      actions={[
        { label: 'Cancel', onSelect: onCancel },
        { label: 'Open', tone: 'primary', submit: true, onSelect: save },
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
