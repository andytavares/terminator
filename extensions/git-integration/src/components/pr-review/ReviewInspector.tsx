import React, { useEffect } from 'react'
import { X } from 'lucide-react'
import { IconButton } from '@terminator/extension-ui'
import './review-inspector.css'

export interface ReviewInspectorProps {
  onClose: () => void
  agentFindingCount: number
  agent: React.ReactNode
}

function InspectorHeader({ count, onClose }: { count: number; onClose: () => void }) {
  return (
    <div className="ri-header">
      <h2 className="ri-title">
        Agent
        {count > 0 && <span className="ri-tab-badge">{count}</span>}
      </h2>
      <IconButton icon={X} size="sm" label="Close inspector" onClick={onClose} />
    </div>
  )
}

export function ReviewInspector(props: ReviewInspectorProps) {
  // The drawer sits over the diff, so a click on the diff must not close it: Escape and the X do.
  const { onClose } = props
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      // A popover or dialog open over the drawer takes the key first.
      if (event.key === 'Escape' && !document.querySelector('dialog:modal, :popover-open'))
        onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])
  return (
    <div className="ri-root">
      <InspectorHeader count={props.agentFindingCount} onClose={onClose} />
      <div className="ri-panel">{props.agent}</div>
    </div>
  )
}
