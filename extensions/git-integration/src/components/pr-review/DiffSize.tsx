import React from 'react'
import { Button } from '@terminator/extension-ui'
import { plural } from '@terminator/extension-sdk'

interface DiffSizeProps {
  additions: number
  deletions: number
  fileCount: number
}

function DiffSize(props: DiffSizeProps): React.JSX.Element {
  const { fileCount } = props
  return (
    <span className="rd-num rd-size">
      <span className="rd-add">+{props.additions.toLocaleString('en-US')}</span>{' '}
      <span className="rd-del">−{props.deletions.toLocaleString('en-US')}</span> ·{' '}
      {fileCount.toLocaleString('en-US')} {plural(fileCount, 'file')}
    </span>
  )
}

export interface MetaPart {
  text: string
  tone?: 'warning' | 'danger' | 'success'
  title?: string
}

const TONE_CLASS = { warning: 'rd-warn', danger: 'rd-bad', success: 'rd-good' } as const

function toneClass(part: MetaPart): string | undefined {
  if (!part.tone) return undefined
  return TONE_CLASS[part.tone]
}

/** The second line of a row: only the states that need attention, joined by dots. */
function RowMeta({ parts }: { parts: (MetaPart | null | false)[] }): React.JSX.Element {
  const shown = parts.filter((p): p is MetaPart => Boolean(p))
  return (
    <small>
      {shown.map((part, i) => (
        <React.Fragment key={part.text}>
          {i > 0 && ' · '}
          <span className={toneClass(part)} title={part.title}>
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
  if (days === 0) return 'today'
  return `${days}d`
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
export function PrRow({
  pr,
  meta,
  action,
  onOpen,
  testId,
  children,
}: PrRowProps): React.JSX.Element {
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
function RowAction({ action, onOpen }: Pick<PrRowProps, 'action' | 'onOpen'>): React.JSX.Element {
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
