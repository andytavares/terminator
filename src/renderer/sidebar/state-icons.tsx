import { Circle, CircleX, Pause, Play } from 'lucide-react'
import type { AgentState } from '../../shared/types/index'
import type { StatusIcon } from './session-status'

/**
 * The four shapes a state is drawn as, in one place.
 *
 * The terminal tabs, the board lanes, the branch rows and the terminal rows
 * all draw the same four; keeping the mapping here is what stops two surfaces
 * disagreeing about what "waiting" looks like.
 */
export const STATUS_ICON: Record<StatusIcon, typeof Circle> = {
  play: Play,
  circle: Circle,
  pause: Pause,
  'circle-x': CircleX,
}

export const ICON_FOR_STATE: Record<AgentState, StatusIcon> = {
  'awaiting-input': 'pause',
  working: 'play',
  idle: 'circle',
  exited: 'circle-x',
}
