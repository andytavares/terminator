import React, { useState } from 'react'
import type { IndexedTask } from '../vault/types'

type InboxStep = 'actionable' | 'two-minute' | 'destination'

interface InboxProcessorProps {
  items: IndexedTask[]
  onDone: () => void
}

export function InboxProcessor({ items, onDone }: InboxProcessorProps): React.JSX.Element {
  const [currentIdx, setCurrentIdx] = useState(0)
  const [step, setStep] = useState<InboxStep>('actionable')
  const [isProcessing, setIsProcessing] = useState(false)
  const [destination, setDestination] = useState('')

  const current = items[currentIdx]

  async function processItem(action: string, dest?: string) {
    if (!current || isProcessing) return
    setIsProcessing(true)
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:process-inbox-item', {
      taskId: current.id,
      action,
      destination: dest,
    })
    advanceToNext()
  }

  function advanceToNext() {
    setIsProcessing(false)
    setStep('actionable')
    setDestination('')
    if (currentIdx + 1 >= items.length) {
      onDone()
    } else {
      setCurrentIdx(currentIdx + 1)
    }
  }

  if (!current) {
    return <div className="inbox-processor__empty">All items processed!</div>
  }

  return (
    <div className="inbox-processor">
      <div className="inbox-processor__progress">
        {currentIdx + 1} of {items.length}
      </div>
      <div className="inbox-processor__item">
        <p className="inbox-processor__text">{current.text}</p>
      </div>

      {step === 'actionable' && (
        <div className="inbox-processor__step">
          <p className="inbox-processor__question">Is this actionable?</p>
          <div className="inbox-processor__actions">
            <button onClick={() => setStep('two-minute')}>Yes</button>
            <button onClick={() => processItem('trash')}>No — trash it</button>
            <button onClick={() => processItem('someday')}>Incubate (someday)</button>
          </div>
        </div>
      )}

      {step === 'two-minute' && (
        <div className="inbox-processor__step">
          <p className="inbox-processor__question">Can it be done in &lt;2 minutes?</p>
          <div className="inbox-processor__actions">
            <button onClick={() => processItem('do-now')}>Do now</button>
            <button onClick={() => setStep('destination')}>No — file it</button>
          </div>
        </div>
      )}

      {step === 'destination' && (
        <div className="inbox-processor__step">
          <p className="inbox-processor__question">Where does it belong?</p>
          <input
            type="text"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="Relative path within vault (e.g., projects/alpha.md)"
            className="inbox-processor__dest-input"
          />
          <div className="inbox-processor__actions">
            <button onClick={() => processItem('file', destination)} disabled={!destination.trim()}>
              File it
            </button>
            <button onClick={() => processItem('someday')}>Move to Someday</button>
            <button onClick={() => setStep('actionable')}>Back</button>
          </div>
        </div>
      )}
    </div>
  )
}
