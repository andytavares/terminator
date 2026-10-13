import React from 'react'
import { Button } from '@terminator/extension-ui'

function DiffSize({
  additions,
  deletions,
  fileCount,
}: {
  additions: number
  deletions: number
  fileCount: number
}): JSX.Element {
  return (
    <span className="rd-num rd-size">
      <span className="rd-add">+{additions.toLocaleString('en-US')}</span>{' '}
      <span className="rd-del">−{deletions.toLocaleString('en-US')}</span> ·{' '}
      {fileCount.toLocaleString('en-US')} file{fileCount === 1 ? '' : 's'}
    </span>
  )
}

export interface MetaPart {
  text: string
  tone?: 'warning' | 'danger' | 'success'
  title?: string
}

const TONE_CLASS = { warning: 'rd-warn', danger: 'rd-bad', success: 'rd-good' } as const

/** The second line of a row: only the states that need attention, joined by dots. */
function RowMeta({ parts }: { parts: (MetaPart | null | false)[] }): JSX.Element {
  const shown = parts.filter((p): p is MetaPart => Boolean(p))
  return (
    <small>
      {shown.map((part, i) => (
        <React.Fragment key={part.text}>
          {i > 0 && ' · '}
          <span className={part.tone ? TONE_CLASS[part.tone] : undefined} title={part.title}>
            {part.text}
          </span>
        </React.Fragment>
      ))}
    </small>
  )
}

/** "139d", or "today" for a pull request opened in the last day. */
export function shortAge(iso: string): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
  return days === 0 ? 'today' : `${days}d`
}

interface PrRowProps {
  pr: {
    number: number
    title: string
    additions: number
    deletions: number
    fileCount: number
    estimatedMinutes: number
  }
  meta: (MetaPart | null | false)[]
  /** The row's own action, which opens the pull request like the row does. */
  action: { label: string; primary: boolean; always: boolean }
  onOpen: () => void
  testId?: string
  /** Actions after the row's own. */
  children?: React.ReactNode
}

/** One pull request in a list: number and title, what needs attention, size, actions. */
export function PrRow({ pr, meta, action, onOpen, testId, children }: PrRowProps): JSX.Element {
  return (
    <div
      className="rd-row rd-row--clickable"
      tabIndex={0}
      data-testid={testId}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
    >
      <span className="rd-ti">
        <span className="rd-t1">
          <span className="rd-no">#{pr.number}</span> <span>{pr.title}</span>
        </span>
        <RowMeta parts={meta} />
      </span>
      <span className="rd-side">
        <DiffSize additions={pr.additions} deletions={pr.deletions} fileCount={pr.fileCount} />
        <span className="rd-num">~{pr.estimatedMinutes} min</span>
      </span>
      <span className="rd-actions">
        <RowAction action={action} onOpen={onOpen} />
        {children}
      </span>
    </div>
  )
}

/** The row's own button. It opens the pull request without the click reaching the row. */
function RowAction({ action, onOpen }: Pick<PrRowProps, 'action' | 'onOpen'>): JSX.Element {
  return (
    <Button
      size="sm"
      variant={action.primary ? 'primary' : 'secondary'}
      className={action.always ? 'rd-row-action rd-always' : 'rd-row-action'}
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
    >
      {action.label}
    </Button>
  )
}
