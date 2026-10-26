import { describe, it, expect } from 'vitest'
import {
  branchStandsForShown,
  listedSessionIds,
  repoStandsForShown,
  shownInMain,
  type MainAreaFacts,
} from '../../../../src/renderer/sidebar/shown-in-main'
import { SCRATCH_PROJECT_ID } from '../../../../src/shared/types/index'
import type { BranchTerminal } from '../../../../src/renderer/sidebar/branch-rows'

const lastShown: Record<string, string> = {
  'terminator-main': 'terminal-1',
  'quicknote-main': 'quicknote-1',
  [SCRATCH_PROJECT_ID]: 'scratch-1',
}

const facts = (overrides: Partial<MainAreaFacts>): MainAreaFacts => ({
  surfaceTabOpen: false,
  projectTabOpen: false,
  scratchActive: false,
  activeProjectId: 'quicknote-main',
  activeSessionOf: (projectId) => lastShown[projectId] ?? null,
  ...overrides,
})

describe('shownInMain', () => {
  it("is the active branch's terminal, not any other branch's last terminal", () => {
    expect(shownInMain(facts({}))).toEqual({
      projectId: 'quicknote-main',
      sessionId: 'quicknote-1',
    })
  })

  it('is nothing while Home, Overview or a repo tab covers the main area', () => {
    expect(shownInMain(facts({ surfaceTabOpen: true }))).toBeNull()
    expect(shownInMain(facts({ surfaceTabOpen: true, scratchActive: true }))).toBeNull()
  })

  it('is the branch without a terminal while an extension tab replaces its terminal', () => {
    expect(shownInMain(facts({ projectTabOpen: true }))).toEqual({
      projectId: 'quicknote-main',
      sessionId: null,
    })
  })

  it('is the scratch terminal while scratch is showing', () => {
    expect(shownInMain(facts({ scratchActive: true }))).toEqual({
      projectId: SCRATCH_PROJECT_ID,
      sessionId: 'scratch-1',
    })
    // Scratch has no extension tabs: a branch's open tab does not cover it.
    expect(shownInMain(facts({ scratchActive: true, projectTabOpen: true }))?.sessionId).toBe(
      'scratch-1'
    )
  })

  it('is nothing when no branch is open', () => {
    expect(shownInMain(facts({ activeProjectId: null }))).toBeNull()
  })
})

describe('branchStandsForShown', () => {
  const shown = { projectId: 'quicknote-main', sessionId: 'quicknote-1' }

  it('marks the branch when its terminal rows are folded away', () => {
    expect(branchStandsForShown(shown, 'quicknote-main', [])).toBe(true)
  })

  it('leaves the branch unmarked when the terminal row itself is listed', () => {
    expect(branchStandsForShown(shown, 'quicknote-main', ['quicknote-1'])).toBe(false)
  })

  it('marks the branch when no listed terminal is the one shown', () => {
    const tabShown = { projectId: 'quicknote-main', sessionId: null }
    expect(branchStandsForShown(tabShown, 'quicknote-main', ['quicknote-1'])).toBe(true)
  })

  it('never marks another branch', () => {
    expect(branchStandsForShown(shown, 'terminator-main', [])).toBe(false)
    expect(branchStandsForShown(null, 'terminator-main', [])).toBe(false)
  })
})

describe('repoStandsForShown', () => {
  const shown = { projectId: 'quicknote-main', sessionId: 'quicknote-1' }

  it('marks a folded repo that holds the shown branch', () => {
    expect(repoStandsForShown(shown, true, ['quicknote-main'])).toBe(true)
  })

  it('leaves an open repo unmarked, since its branch row is listed', () => {
    expect(repoStandsForShown(shown, false, ['quicknote-main'])).toBe(false)
  })

  it('never marks a repo without the shown branch', () => {
    expect(repoStandsForShown(shown, true, ['terminator-main'])).toBe(false)
    expect(repoStandsForShown(null, true, ['quicknote-main'])).toBe(false)
  })
})

/** Only the ids matter to listedSessionIds. */
function terminal(sessionId: string, panes: string[] = []): BranchTerminal {
  return { sessionId, panes: panes.map((pane) => terminal(pane)) } as BranchTerminal
}

describe('listedSessionIds', () => {
  it('lists each terminal, then the panes split off it', () => {
    const terminals = [terminal('quicknote-1', ['quicknote-2']), terminal('quicknote-3')]
    expect(listedSessionIds(terminals)).toEqual(['quicknote-1', 'quicknote-2', 'quicknote-3'])
  })
})
