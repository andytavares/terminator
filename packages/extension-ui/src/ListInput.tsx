import React, { useState } from 'react'
import './extension-ui.css'

/*
 * A list of short strings edited as text, one item per line: globs, tool
 * names, repositories. Each line is trimmed and blank lines are skipped, so
 * the list handed back never holds an empty item. The box keeps what is being
 * typed, a new empty line included, and adopts a list changed from outside.
 */

export interface ListInputProps {
  /** Names the box for assistive technology: "Critical paths". */
  label: string
  value: readonly string[]
  onChange: (items: string[]) => void
  placeholder?: string
  /** Visible lines before the box scrolls. Default 4. */
  rows?: number
  className?: string
}

/** The items in a list's text: one per line, trimmed, blank lines skipped. */
export function listItems(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

function sameItems(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i])
}

export function ListInput({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
  className,
}: ListInputProps): JSX.Element {
  const [text, setText] = useState(value.join('\n'))
  const [shown, setShown] = useState(value)
  // A list changed from outside replaces the text, unless the text already says it.
  if (!sameItems(value, shown)) {
    setShown(value)
    if (!sameItems(value, listItems(text))) setText(value.join('\n'))
  }
  return (
    <textarea
      aria-label={label}
      className={['tmui-list-input', className].filter(Boolean).join(' ')}
      rows={rows}
      value={text}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(event) => {
        setText(event.target.value)
        onChange(listItems(event.target.value))
      }}
    />
  )
}
