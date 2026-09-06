import { existsSync } from 'node:fs'
import * as path from 'node:path'
import type { PhaseId } from '../types/speckit.types.js'

// Whether this repository actually has the SpecKit skills.
//
// A phase used to send `/speckit-specify …` unconditionally. In a repository
// that has not run `specify init` — or, more often, one where `.claude/skills/`
// is untracked, so the worktree the run happens in never received it — the
// runtime answers "Unknown command: /speckit-specify" and the phase is over
// before it began, having produced nothing.
//
// Checked in the worktree, not the main checkout: the worktree is where the
// agent runs, and `git worktree add` only brings across what is committed.

/** Where Claude Code looks for a project's skills and commands. */
function candidates(worktreePath: string, skill: string): string[] {
  return [
    path.join(worktreePath, '.claude', 'skills', skill, 'SKILL.md'),
    path.join(worktreePath, '.claude', 'commands', `${skill}.md`),
  ]
}

/** The skill a phase invokes, or null for phases that never use one. */
export function skillForPhase(phase: PhaseId): string | null {
  switch (phase) {
    case 'self-review':
    case 'open-pr':
      return null
    default:
      return `speckit-${phase}`
  }
}

export function hasSpeckitSkill(worktreePath: string, phase: PhaseId): boolean {
  const skill = skillForPhase(phase)
  if (skill === null) return false
  return candidates(worktreePath, skill).some((candidate) => existsSync(candidate))
}
