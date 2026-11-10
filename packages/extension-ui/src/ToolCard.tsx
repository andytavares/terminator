import React, { useState } from 'react'
import { Check, Circle, CircleSlash, LoaderCircle, X } from 'lucide-react'
import { Button } from './Button'
import { Chip } from './Chip'
import './tool-card.css'

export type ToolCardStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled'

export interface ToolCardProps {
  /** A lucide icon for the kind of tool; it inherits the header's colour. Leave it out when
   * the card sits beside its own icon, as on the agent tab's rail. */
  icon?: React.ReactNode
  title: string
  /** The command or path the tool acted on, cut to one line. */
  detail?: string | null
  status: ToolCardStatus
  /** The tool's output; past 3 lines it starts collapsed. */
  preview?: string
  children?: React.ReactNode
}

const COLLAPSED_LINES = 3

const STATUS_CHIP: Record<ToolCardStatus, { icon: React.ReactNode; text: string }> = {
  pending: { icon: <Circle aria-hidden="true" />, text: 'Waiting' },
  in_progress: { icon: <LoaderCircle aria-hidden="true" className="tmui-spin" />, text: 'Running' },
  completed: { icon: <Check aria-hidden="true" />, text: 'Done' },
  failed: { icon: <X aria-hidden="true" />, text: 'Failed' },
  cancelled: { icon: <CircleSlash aria-hidden="true" />, text: 'Cancelled' },
}

/** One agent tool call: what ran, its state, and its output. */
export function ToolCard({
  icon,
  title,
  detail,
  status,
  preview,
  children,
}: ToolCardProps): React.JSX.Element {
  const chip = STATUS_CHIP[status]
  return (
    <div role="group" aria-label={detail ? `${title} ${detail}` : title} className="tmui-tool-card">
      <div className="tmui-tool-card__header">
        {icon}
        <span className="tmui-tool-card__title">{title}</span>
        <span className="tmui-tool-card__detail">{detail}</span>
        <Chip icon={chip.icon}>{chip.text}</Chip>
      </div>
      {preview !== undefined && <ToolCardPreview text={preview} />}
      {children !== undefined && <div className="tmui-tool-card__body">{children}</div>}
    </div>
  )
}

/** The output, cut to its first lines with a fade until the reader asks for all of it. */
function ToolCardPreview({ text }: { text: string }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const lines = text.split('\n')
  const long = lines.length > COLLAPSED_LINES
  const collapsed = long && !expanded
  const className = `tmui-tool-card__body tmui-tool-card__preview${collapsed ? ' tmui-tool-card__preview--collapsed' : ''}`
  return (
    <>
      <div className={className}>
        {collapsed ? lines.slice(0, COLLAPSED_LINES).join('\n') : text}
      </div>
      {long && (
        <div className="tmui-tool-card__toggle">
          <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Show less' : `Show all ${lines.length} lines`}
          </Button>
        </div>
      )}
    </>
  )
}
