import React, { useState } from 'react'

const MIN_LINES = 1000
const MAX_LINES = 100000

interface ScrollbackInputProps {
  value: number
  onSave: (lines: number) => void
}

/** The typed text, kept as is; `commitDraft` saves it only when it is in range. */
function useScrollbackDraft({ value, onSave }: ScrollbackInputProps) {
  const [draft, setDraft] = useState(String(value))
  const [saved, setSaved] = useState(value)
  const [outOfRange, setOutOfRange] = useState(false)
  if (value !== saved) {
    setSaved(value)
    setDraft(String(value))
  }
  const commitDraft = (): void => {
    const lines = Number(draft)
    const inRange = Number.isInteger(lines) && lines >= MIN_LINES && lines <= MAX_LINES
    setOutOfRange(!inRange)
    if (inRange && lines !== value) onSave(lines)
  }
  return { draft, setDraft, outOfRange, commitDraft }
}

/** The scrollback limit field: keeps what is typed, and checks the range only on blur or Enter. */
export function ScrollbackInput(props: ScrollbackInputProps): React.JSX.Element {
  const { draft, setDraft, outOfRange, commitDraft } = useScrollbackDraft(props)
  return (
    <>
      <input
        type="number"
        className="settings-section__input"
        value={draft}
        min={MIN_LINES}
        max={MAX_LINES}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => e.key === 'Enter' && commitDraft()}
      />
      {outOfRange && (
        <span className="settings-section__hint" role="alert">
          Enter a number from 1,000 to 100,000.
        </span>
      )}
    </>
  )
}
