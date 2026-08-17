import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasSpeckitSkill, skillForPhase } from '../../src/state/skill-availability.js'

// A phase used to send `/speckit-specify …` unconditionally. Where the skills
// are not installed — most often because `.claude/skills/` is untracked, so the
// worktree the run happens in never received it — the runtime answers "Unknown
// command: /speckit-specify" and the phase is over before it began.

let worktree: string

function installSkill(name: string): void {
  mkdirSync(join(worktree, '.claude', 'skills', name), { recursive: true })
  writeFileSync(join(worktree, '.claude', 'skills', name, 'SKILL.md'), '# skill\n')
}

beforeEach(() => {
  worktree = mkdtempSync(join(tmpdir(), 'skills-'))
})

afterEach(() => rmSync(worktree, { recursive: true, force: true, maxRetries: 5 }))

describe('which skill a phase wants', () => {
  it('is the speckit one of the same name', () => {
    expect(skillForPhase('specify')).toBe('speckit-specify')
  })

  it.each(['self-review', 'open-pr'] as const)('is none for %s', (phase) => {
    // Neither is dispatched as a prompt; self-review runs a command chain and
    // open-pr is an explicit action.
    expect(skillForPhase(phase)).toBeNull()
  })
})

describe('finding it in the worktree', () => {
  it('finds a skill the repository installed', () => {
    installSkill('speckit-specify')
    expect(hasSpeckitSkill(worktree, 'specify')).toBe(true)
  })

  it('finds one installed as a command instead', () => {
    mkdirSync(join(worktree, '.claude', 'commands'), { recursive: true })
    writeFileSync(join(worktree, '.claude', 'commands', 'speckit-plan.md'), '# plan\n')
    expect(hasSpeckitSkill(worktree, 'plan')).toBe(true)
  })

  it('reports the ones that are not there', () => {
    installSkill('speckit-specify')
    expect(hasSpeckitSkill(worktree, 'plan')).toBe(false)
  })

  it('reports nothing in a repository with no .claude at all', () => {
    expect(hasSpeckitSkill(worktree, 'specify')).toBe(false)
  })

  it('looks in the worktree, not the checkout it was cut from', () => {
    // `git worktree add` only brings across what is committed, and
    // `.claude/skills/` is routinely untracked — which is exactly how a run
    // ends up without them.
    const mainCheckout = mkdtempSync(join(tmpdir(), 'main-'))
    mkdirSync(join(mainCheckout, '.claude', 'skills', 'speckit-specify'), { recursive: true })
    writeFileSync(join(mainCheckout, '.claude', 'skills', 'speckit-specify', 'SKILL.md'), '#\n')
    try {
      expect(hasSpeckitSkill(worktree, 'specify')).toBe(false)
    } finally {
      rmSync(mainCheckout, { recursive: true, force: true })
    }
  })

  it('says no for a phase that never uses one', () => {
    installSkill('speckit-self-review')
    expect(hasSpeckitSkill(worktree, 'self-review')).toBe(false)
  })
})
