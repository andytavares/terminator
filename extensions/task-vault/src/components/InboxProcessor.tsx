import React, { useState } from 'react'
import type { IndexedTask } from '../vault/types'
import { FileToPicker } from './FileToPicker'
import { useVaultStore } from '../stores/vault.store'
import { Button } from '@terminator/extension-ui'

type InboxStep = 'actionable' | 'two-minute' | 'destination'

interface InboxProcessorProps {
  items: IndexedTask[]
  onDone: () => void
}

/** Where an item goes: an action, and for filing, a destination or a new project. */
interface Decision {
  action: string
  dest?: string
  newProjectName?: string
}

/** Whether processing failed for a reason other than the item already being gone. */
function failed(result: unknown): boolean {
  if (!result || typeof result !== 'object' || !('error' in result)) return false
  return (result as { error: string }).error !== 'STALE_ID'
}

function submitDecision(item: IndexedTask, decision: Decision): Promise<unknown> {
  return window.electronAPI.extensionBridge.invoke('task-vault:vault:process-inbox-item', {
    taskId: item.id,
    action: decision.action,
    destination: decision.dest,
    newProjectName: decision.newProjectName,
  })
}

/** Steps through the items one decision at a time; returns the current item and `decide`. */
function useInboxQueue(props: InboxProcessorProps) {
  const { items, onDone } = props
  // The list it was opened with: the inbox reloads as each item is filed, and
  // walking the shrinking list by index would skip the item after each one.
  const [queue] = useState(items)
  const [currentIdx, setCurrentIdx] = useState(0)
  const [step, setStep] = useState<InboxStep>('actionable')
  const [isProcessing, setIsProcessing] = useState(false)
  const { refreshInboxCount } = useVaultStore()
  const current = queue[currentIdx]

  function advanceToNext() {
    setIsProcessing(false)
    setStep('actionable')
    if (currentIdx + 1 >= queue.length) onDone()
    else setCurrentIdx(currentIdx + 1)
  }

  async function decideItem(decision: Decision) {
    if (!current || isProcessing) return
    setIsProcessing(true)
    try {
      if (failed(await submitDecision(current, decision))) return setIsProcessing(false)
      await refreshInboxCount()
      advanceToNext()
    } catch {
      setIsProcessing(false)
    }
  }

  return { current, currentIdx, total: queue.length, step, setStep, decide: decideItem }
}

/** Files to a new area (created first, in the path form resolveSource expects) or a new project. */
async function fileToNew(
  decide: (d: Decision) => Promise<void>,
  kind: 'project' | 'area',
  name: string
) {
  if (kind === 'project') return decide({ action: 'file', newProjectName: name })
  await window.electronAPI.extensionBridge
    .invoke('task-vault:vault:create-area', { name })
    .catch(() => {})
  await decide({ action: 'file', dest: `areas/${name}.md` })
}

interface StepProps {
  item: IndexedTask
  setStep: (step: InboxStep) => void
  decide: (decision: Decision) => Promise<void>
}

function ActionableStep({ setStep, decide }: StepProps): React.JSX.Element {
  return (
    <div className="inbox-processor__step">
      <p className="inbox-processor__question">Is this actionable?</p>
      <div className="inbox-processor__actions">
        <Button variant="primary" onClick={() => setStep('two-minute')}>
          Yes
        </Button>
        <Button variant="danger" onClick={() => void decide({ action: 'trash' })}>
          Trash it
        </Button>
        <Button onClick={() => void decide({ action: 'someday' })}>Incubate — Backlog</Button>
      </div>
    </div>
  )
}

function TwoMinuteStep({ setStep, decide }: StepProps): React.JSX.Element {
  return (
    <div className="inbox-processor__step">
      <p className="inbox-processor__question">Can it be done in &lt;2 minutes?</p>
      <div className="inbox-processor__actions">
        <Button variant="primary" onClick={() => void decide({ action: 'do-now' })}>
          Do now — Today
        </Button>
        <Button onClick={() => setStep('destination')}>No — File it</Button>
      </div>
    </div>
  )
}

function DestinationStep({ item, setStep, decide }: StepProps): React.JSX.Element {
  return (
    <div className="inbox-processor__step">
      <p className="inbox-processor__question">Where does it belong?</p>
      <FileToPicker
        prefilledQuery={item.project ?? item.area ?? ''}
        onSelect={(filePath) => void decide({ action: 'file', dest: filePath })}
        onSelectNew={(kind, name) => void fileToNew(decide, kind, name)}
        onClose={() => setStep('two-minute')}
      />
      <div className="inbox-processor__actions" style={{ marginTop: 10 }}>
        <Button onClick={() => void decide({ action: 'someday' })}>Backlog</Button>
        <Button onClick={() => setStep('two-minute')}>Back</Button>
      </div>
    </div>
  )
}

const STEPS: Record<InboxStep, (props: StepProps) => React.JSX.Element> = {
  actionable: ActionableStep,
  'two-minute': TwoMinuteStep,
  destination: DestinationStep,
}

function ItemCard({ item }: { item: IndexedTask }): React.JSX.Element {
  return (
    <div className="inbox-processor__item">
      <p className="inbox-processor__text">{item.text}</p>
      {item.project && (
        <span className="daily-log__tag daily-log__tag--project">{`@${item.project}`}</span>
      )}
      {item.area && <span className="daily-log__tag daily-log__tag--area">{`#${item.area}`}</span>}
    </div>
  )
}

export function InboxProcessor(props: InboxProcessorProps): React.JSX.Element {
  const { current, currentIdx, total, step, setStep, decide } = useInboxQueue(props)
  if (!current) {
    return <div className="inbox-processor__empty">All items processed!</div>
  }
  const Step = STEPS[step]
  return (
    <div className="inbox-processor">
      <div className="inbox-processor__progress">
        {currentIdx + 1} of {total}
      </div>
      <ItemCard item={current} />
      <Step item={current} setStep={setStep} decide={decide} />
    </div>
  )
}
