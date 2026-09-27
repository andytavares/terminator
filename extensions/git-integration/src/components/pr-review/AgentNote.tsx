import React from 'react'
import { RichContent } from './RichContent'
import type { FindingSeverity } from '../../schemas/review-agent.schema'

interface Props {
  severity: FindingSeverity
  body: string
}

const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  'must-fix': 'must-fix',
  suggestion: 'suggestion',
  nit: 'nit',
  question: 'question',
}

/** A dashed, agent-authored note in the diff (R5). Private to the reviewer. */
export function AgentNote({ severity, body }: Props) {
  return (
    <div className="rs-thread rs-thread--agent">
      <div className="rs-thread-th">
        Agent note · private ·{' '}
        <span className={`rs-sev rs-sev--${severity}`}>{SEVERITY_LABEL[severity]}</span>
      </div>
      <div className="rs-thread-bd">
        <RichContent>{body}</RichContent>
      </div>
    </div>
  )
}
