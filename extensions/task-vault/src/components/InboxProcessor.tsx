import React, { useState } from 'react'
import type { IndexedTask } from '../vault/types'
import { FileToPicker } from './FileToPicker'

type InboxStep = 'actionable' | 'two-minute' | 'destination'

interface InboxProcessorProps {
  items: IndexedTask[]
  onDone: () => void
}

export function InboxProcessor({ items, onDone }: InboxProcessorProps): React.JSX.Element {
  const [currentIdx, setCurrentIdx] = useState(0)
  const [step, setStep] = useState<InboxStep>('actionable')
  const [isProcessing, setIsProcessing] = useState(false)

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
            <button className="tv-btn tv-btn--primary" onClick={() => setStep('two-minute')}>
              Yes
            </button>
            <button className="tv-btn tv-btn--danger" onClick={() => processItem('trash')}>
              No — trash it
            </button>
            <button className="tv-btn tv-btn--secondary" onClick={() => processItem('someday')}>
              Incubate (someday)
            </button>
          </div>
        </div>
      )}

      {step === 'two-minute' && (
        <div className="inbox-processor__step">
          <p className="inbox-processor__question">Can it be done in &lt;2 minutes?</p>
          <div className="inbox-processor__actions">
            <button className="tv-btn tv-btn--primary" onClick={() => processItem('do-now')}>
              Do now
            </button>
            <button className="tv-btn tv-btn--secondary" onClick={() => setStep('destination')}>
              No — file it
            </button>
          </div>
        </div>
      )}

      {step === 'destination' && (
        <div className="inbox-processor__step">
          <p className="inbox-processor__question">Where does it belong?</p>
          <FileToPicker
            prefilledQuery={current.project ?? current.area ?? ''}
            onSelect={(filePath) => processItem('file', filePath)}
            onClose={() => setStep('actionable')}
          />
          <div className="inbox-processor__actions">
            <button className="tv-btn tv-btn--secondary" onClick={() => processItem('someday')}>
              Move to Someday
            </button>
            <button className="tv-btn tv-btn--secondary" onClick={() => setStep('actionable')}>
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
