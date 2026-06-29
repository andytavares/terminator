import React from 'react'
import {
  Puzzle,
  Wrench,
  Terminal,
  GitBranch,
  GitPullRequest,
  Database,
  Code,
  Layers,
  Settings,
  File,
  Search,
  Box,
  Star,
  Zap,
  Globe,
  Cpu,
  FlaskConical,
  BarChart,
  List,
  Calendar,
  Wifi,
  Check,
  Brain,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const ICON_MAP: Record<string, LucideIcon> = {
  puzzle: Puzzle,
  wrench: Wrench,
  terminal: Terminal,
  'git-branch': GitBranch,
  'git-pull-request': GitPullRequest,
  database: Database,
  code: Code,
  layers: Layers,
  settings: Settings,
  file: File,
  search: Search,
  box: Box,
  star: Star,
  zap: Zap,
  globe: Globe,
  cpu: Cpu,
  flask: FlaskConical,
  'chart-bar': BarChart,
  list: List,
  calendar: Calendar,
  wifi: Wifi,
  check: Check,
  brain: Brain,
}

export const CURATED_ICON_NAMES = Object.keys(ICON_MAP) as ReadonlyArray<string>

export function iconFromName(name: string): React.ReactElement {
  const Icon = ICON_MAP[name] ?? Puzzle
  return React.createElement(Icon)
}
