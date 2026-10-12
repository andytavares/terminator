import React from 'react'
import { plural } from '../text'

interface DiffSizeProps {
  additions: number
  deletions: number
  fileCount: number
}

export function DiffSize(props: DiffSizeProps): JSX.Element {
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
export function RowMeta({ parts }: { parts: (MetaPart | null | false)[] }): JSX.Element {
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
