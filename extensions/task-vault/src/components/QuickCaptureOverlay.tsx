import React, { useEffect, useRef, useState } from 'react'

interface SuggestionBadge {
  type: 'project' | 'context' | 'area'
  value: string
}

function detectTags(text: string): SuggestionBadge[] {
  const badges: SuggestionBadge[] = []
  const projMatch = /\+(\S+)/.exec(text)
  if (projMatch) badges.push({ type: 'project', value: projMatch[1] })
  const ctxMatch = /@(\S+)/.exec(text)
  if (ctxMatch) badges.push({ type: 'context', value: ctxMatch[1] })
  const areaMatch = /#(\S+)/.exec(text)
  if (areaMatch) badges.push({ type: 'area', value: areaMatch[1] })
  return badges
}

export function QuickCaptureOverlay(): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [badges, setBadges] = useState<SuggestionBadge[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setText(val)
    setBadges(detectTags(val))
  }

  async function capture(destination?: string) {
    if (!text.trim() || isSubmitting) return
    setIsSubmitting(true)
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:capture', {
      text: text.trim(),
      ...(destination ? { hintArea: destination } : {}),
    })
    window.close()
  }

  async function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
      await capture()
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      // ⌘Enter — file to suggested destination
      const areaTag = badges.find((b) => b.type === 'area')
      await capture(areaTag?.value)
    }
    if (e.key === 'Escape') {
      window.close()
    }
  }

  return (
    <div className="quick-capture">
      <input
        ref={inputRef}
        className="quick-capture__input"
        type="text"
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Capture a task… (+project @context #area due:YYYY-MM-DD)"
        disabled={isSubmitting}
      />
      {badges.length > 0 && (
        <div className="quick-capture__badges">
          {badges.map((b) => (
            <span
              key={`${b.type}-${b.value}`}
              className={`quick-capture__badge quick-capture__badge--${b.type}`}
            >
              {b.type === 'project' && '+'}
              {b.type === 'context' && '@'}
              {b.type === 'area' && '#'}
              {b.value}
            </span>
          ))}
        </div>
      )}
      <div className="quick-capture__hint">
        Enter to capture · ⌘Enter to file to suggestion · Esc to cancel
      </div>
    </div>
  )
}
