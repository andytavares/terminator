import React, { useState } from 'react'
import type { IndexedTask } from '../vault/types'
import { FileToPicker } from './FileToPicker'
import { useVaultStore } from '../stores/vault.store'

type InboxStep = 'actionable' | 'two-minute' | 'destination'

interface InboxProcessorProps {
  items: IndexedTask[]
  onDone: () => void
}

export function InboxProcessor({ items, onDone }: InboxProcessorProps): React.JSX.Element {
  const [currentIdx, setCurrentIdx] = useState(0)
  const [step, setStep] = useState<InboxStep>('actionable')
  const [isProcessing, setIsProcessing] = useState(false)
  const { refreshInboxCount } = useVaultStore()

  const current = items[currentIdx]

  async function processItem(action: string, dest?: string, newProjectName?: string) {
    if (!current || isProcessing) return
    setIsProcessing(true)
    try {
      const result = await window.electronAPI.extensionBridge.invoke(
        'task-vault:vault:process-inbox-item',
        { taskId: current.id, action, destination: dest, newProjectName }
      )
      if (result && typeof result === 'object' && 'error' in result) {
        const err = (result as { error: string }).error
        if (err !== 'STALE_ID') {
          setIsProcessing(false)
          return
        }
      }
      await refreshInboxCount()
      advanceToNext()
    } catch {
      setIsProcessing(false)
    }
  }

  async function handleFileNew(kind: 'project' | 'area', name: string) {
    if (kind === 'area') {
      await window.electronAPI.extensionBridge
        .invoke('task-vault:vault:create-area', { name })
        .catch(() => {})
      // Use the path format resolveSource expects: areas/<name>.md
      await processItem('file', `areas/${name}.md`)
    } else {
      await processItem('file', undefined, name)
    }
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
        {current.project && (
          <span className="daily-log__tag daily-log__tag--project">@{current.project}</span>
        )}
        {current.area && (
          <span className="daily-log__tag daily-log__tag--area">#{current.area}</span>
        )}
      </div>

      {step === 'actionable' && (
        <div className="inbox-processor__step">
          <p className="inbox-processor__question">Is this actionable?</p>
          <div className="inbox-processor__actions">
            <button className="tv-btn tv-btn--primary" onClick={() => setStep('two-minute')}>
              Yes
            </button>
            <button className="tv-btn tv-btn--danger" onClick={() => void processItem('trash')}>
              Trash it
            </button>
            <button
              className="tv-btn tv-btn--secondary"
              onClick={() => void processItem('someday')}
            >
              Incubate — Backlog
            </button>
          </div>
        </div>
      )}

      {step === 'two-minute' && (
        <div className="inbox-processor__step">
          <p className="inbox-processor__question">Can it be done in &lt;2 minutes?</p>
          <div className="inbox-processor__actions">
            <button className="tv-btn tv-btn--primary" onClick={() => void processItem('do-now')}>
              Do now — Today
            </button>
            <button className="tv-btn tv-btn--secondary" onClick={() => setStep('destination')}>
              No — File it
            </button>
          </div>
        </div>
      )}

      {step === 'destination' && (
        <div className="inbox-processor__step">
          <p className="inbox-processor__question">Where does it belong?</p>
          <FileToPicker
            prefilledQuery={current.project ?? current.area ?? ''}
            onSelect={(filePath) => void processItem('file', filePath)}
            onSelectNew={(kind, name) => void handleFileNew(kind, name)}
            onClose={() => setStep('two-minute')}
          />
          <div className="inbox-processor__actions" style={{ marginTop: 10 }}>
            <button
              className="tv-btn tv-btn--secondary"
              onClick={() => void processItem('someday')}
            >
              Backlog
            </button>
            <button className="tv-btn tv-btn--secondary" onClick={() => setStep('two-minute')}>
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
