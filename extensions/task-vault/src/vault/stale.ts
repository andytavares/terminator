import type { Project } from './types'

export function isProjectStale(project: Project, thresholdDays: number): boolean {
  if (project.nextActions.length === 0) return true
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000
  return Date.now() - project.lastModified.getTime() > thresholdMs
}
