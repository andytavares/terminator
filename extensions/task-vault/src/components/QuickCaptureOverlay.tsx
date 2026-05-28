import React, { useState } from 'react'
import { SmartTaskInput } from './SmartTaskInput'
import './task-vault.css'

export function QuickCaptureOverlay(): React.JSX.Element {
  const [text, setText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function capture(destination?: string) {
    if (!text.trim() || isSubmitting) return
    setIsSubmitting(true)
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:capture', {
      text: text.trim(),
      ...(destination ? { hintArea: destination } : {}),
    })
    window.close()
  }

  function handleSubmit() {
    void capture()
  }

  return (
    <div className="quick-capture">
      <SmartTaskInput
        value={text}
        onChange={setText}
        onSubmit={handleSubmit}
        onCancel={() => window.close()}
        placeholder="Capture a task… (@project #area +context due:YYYY-MM-DD)"
        disabled={isSubmitting}
        autoFocus
        className="quick-capture__input"
      />
      <div className="quick-capture__hint">Enter to capture · Esc to cancel</div>
    </div>
  )
}
