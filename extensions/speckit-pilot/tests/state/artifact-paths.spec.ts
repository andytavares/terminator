import { describe, it, expect } from 'vitest'
import {
  repoRootOf,
  resolveArtifactPath,
  resolveArtifactPaths,
} from '../../src/state/artifact-paths.js'

// A path recorded at plan time and a path read at review time are two different
// checkouts. Verified against real git: `git worktree add` checks out a branch,
// so the card directory the board created — uncommitted, in the main checkout —
// is not in the worktree at all. The agent creates it there and writes
// everything into it.

const featureDir = '/repo/specs/021-a'
const worktree = '/repo/.worktrees/feat-a'

describe('the repository a card belongs to', () => {
  it('is two levels up from the card', () => {
    expect(repoRootOf(featureDir)).toBe('/repo')
  })
})

describe('while a card has a worktree', () => {
  it('reads the artifact the run is actually writing', () => {
    expect(
      resolveArtifactPath({ featureDir, worktreePath: worktree }, `${featureDir}/spec.md`)
    ).toBe(`${worktree}/specs/021-a/spec.md`)
  })

  it('resolves the constitution, which is recorded repository-relative', () => {
    // Left as-is it would be read against the process's working directory,
    // which is not the repository — and every approval would look modified.
    expect(
      resolveArtifactPath({ featureDir, worktreePath: worktree }, '.specify/memory/constitution.md')
    ).toBe(`${worktree}/.specify/memory/constitution.md`)
  })

  it('keeps a nested artifact nested', () => {
    expect(
      resolveArtifactPath(
        { featureDir, worktreePath: worktree },
        `${featureDir}/checklists/requirements.md`
      )
    ).toBe(`${worktree}/specs/021-a/checklists/requirements.md`)
  })

  it('resolves every artifact of a phase at once', () => {
    expect(
      resolveArtifactPaths({ featureDir, worktreePath: worktree }, [
        `${featureDir}/plan.md`,
        `${featureDir}/research.md`,
      ])
    ).toEqual([`${worktree}/specs/021-a/plan.md`, `${worktree}/specs/021-a/research.md`])
  })
})

describe('when it does not', () => {
  it('reads the main checkout — a merged branch left them there', () => {
    expect(resolveArtifactPath({ featureDir }, `${featureDir}/spec.md`)).toBe(
      '/repo/specs/021-a/spec.md'
    )
  })

  it('treats a reclaimed worktree the same as never having had one', () => {
    expect(resolveArtifactPath({ featureDir, worktreePath: null }, '.specify/memory/x.md')).toBe(
      '/repo/.specify/memory/x.md'
    )
  })
})

describe('a path that is not in the repository', () => {
  it('is left alone rather than invented somewhere else', () => {
    // Reading nothing is better than reading the wrong file.
    expect(
      resolveArtifactPath({ featureDir, worktreePath: worktree }, '/somewhere/else/spec.md')
    ).toBe('/somewhere/else/spec.md')
  })
})
