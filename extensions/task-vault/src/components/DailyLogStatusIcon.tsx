import React from 'react'
import { ArrowRightCircle, CheckCircle2, Circle, MinusCircle, OctagonAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { IndexedTask } from '../vault/types'

interface StatusIconProps {
  status: IndexedTask['status']
  size?: number
}

const STATUS_ICONS: Partial<Record<IndexedTask['status'], LucideIcon>> = {
  done: CheckCircle2,
  cancelled: MinusCircle,
  migrated: ArrowRightCircle,
  'in-progress': Circle,
  blocked: OctagonAlert,
}

/** The task's status as an icon; any other status reads as open. */
export function StatusIcon({ status, size = 15 }: StatusIconProps): React.JSX.Element {
  const Icon = STATUS_ICONS[status]
  if (!Icon) return <Circle size={size} className="task-status task-status--open" />
  return <Icon size={size} className={`task-status task-status--${status}`} />
}
