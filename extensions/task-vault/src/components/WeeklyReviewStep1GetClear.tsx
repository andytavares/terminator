import React, { useState } from 'react'

interface Props {
  onComplete: () => void
}

export function WeeklyReviewStep1GetClear({ onComplete }: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  const [captured, setCaptured] = useState<string[]>([])

  async function handleAdd() {
    if (!text.trim()) return
    setAdding(true)
    try {
      await window.electronAPI.extensionBridge.invoke('task-vault:vault:add-task', {
        text: text.trim(),
        source: 'inbox',
      })
      setCaptured((prev) => [...prev, text.trim()])
      setText('')
    } finally {
      setAdding(false)
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') void handleAdd()
  }

  return (
    <div className="wr-step wr-step-1">
      <h3>Step 1: Get Clear</h3>
      <p>
        Capture any loose items not yet in your inbox — physical papers, email, sticky notes, open
        browser tabs.
      </p>

      <div className="wr-step__capture-row">
        <input
          className="wr-step__capture-input"
          placeholder="Add to inbox…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKey}
          disabled={adding}
          autoFocus
        />
        <button
          className="tv-btn tv-btn--primary"
          onClick={() => void handleAdd()}
          disabled={adding || !text.trim()}
        >
          Add
        </button>
      </div>

      {captured.length > 0 && (
        <ul className="wr-step__captured-list">
          {captured.map((item, i) => (
            <li key={i} className="wr-step__captured-item">
              ✓ {item}
            </li>
          ))}
        </ul>
      )}

      <button className="wr-step__next" onClick={onComplete}>
        {captured.length === 0 ? 'Nothing to add — Next' : 'Done capturing — Next'}
      </button>
    </div>
  )
}
