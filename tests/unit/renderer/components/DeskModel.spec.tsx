import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWorkThreads } from '../../../../src/renderer/components/home/useWorkThreads'
import {
  useDeskSelection,
  useOrderedThreadKeys,
} from '../../../../src/renderer/components/home/desk-selection'
import { useParkedThreads } from '../../../../src/renderer/components/home/parked-threads'
import { useHomeView } from '../../../../src/renderer/components/home/home-view'
import {
  ageInWords,
  compactAge,
  pullRequestOf,
} from '../../../../src/renderer/components/home/thread-format'
import { deskGroups } from '../../../../src/renderer/components/home/desk-groups'
import {
  buildTimeline,
  timelineTime,
} from '../../../../src/renderer/components/home/thread-timeline'
import { workKeyOfThread } from '../../../../src/renderer/components/home/focus-options'
import { summaryInputOf } from '../../../../src/renderer/components/home/useThreadSummary'
import { usageLabel } from '../../../../src/renderer/components/home/useSessionUsage'
import { FACTS, NOW, REPO_ROOT, seedDesk } from '../home/desk-world'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { defaultGlobalSettings } from '../../../../src/shared/settings-defaults'
import type { HomeLayout } from '../../../../src/shared/schemas/settings.schema'
import type { WorkThread } from '../../../../src/renderer/home/work-threads'

const world = vi.hoisted(() => ({ facts: [] as unknown[] }))
vi.mock('../../../../src/renderer/components/session/useSessionFacts', () => ({
  useSessionFacts: () => world.facts,
}))

const deskFilter = vi.hoisted(() => ({ text: '', count: null as string | null }))
vi.mock('../../../../src/renderer/components/home/desk-filter', () => ({
  useDeskFilter: () => deskFilter,
}))

beforeEach(() => {
  localStorage.clear()
  world.facts = FACTS
  seedDesk()
  useDeskSelection.setState({ expandedGroupIds: [], groupBy: 'move' })
  useParkedThreads.setState({ keys: [] })
})

const workThreadOf = (key: string): WorkThread => {
  const { result } = renderHook(() => useWorkThreads())
  return result.current.threads.find((t) => t.key === key) as WorkThread
}

describe('useWorkThreads', () => {
  it('builds repo roots from workspace folders, so a branch-keyed pull request joins its session', () => {
    const thread = workThreadOf('linear:TAV-20')
    expect(thread.sessions.map((s) => s.sessionId)).toEqual(['building'])
    expect(thread.facets).toHaveLength(1)
    expect(thread.facets[0].workKey).toEqual({ repoRoot: REPO_ROOT, branch: 'tav-20' })
  })

  it('marks a thread the operator parked by hand archived and leaves it out of the groups', () => {
    act(() => useParkedThreads.getState().park('linear:TAV-20'))
    const { result } = renderHook(() => useWorkThreads())
    expect(result.current.threads.find((t) => t.key === 'linear:TAV-20')?.archived).toBe(true)
    expect(result.current.groups.flatMap((g) => g.threads.map((t) => t.key))).not.toContain(
      'linear:TAV-20'
    )
  })

  it('keeps the parked set across a reload', () => {
    act(() => useParkedThreads.getState().park('a'))
    act(() => useParkedThreads.getState().park('a'))
    expect(JSON.parse(localStorage.getItem('terminator.home.parked-threads') as string)).toEqual({
      a: expect.any(Number),
    })
    act(() => useParkedThreads.getState().unpark('a'))
    expect(useParkedThreads.getState().keys).toEqual([])
  })
})

function useHomeLayoutSetting(homeLayout: HomeLayout): void {
  const defaults = defaultGlobalSettings('/bin/zsh')
  useSettingsStore.setState({ globalSettings: { ...defaults, ui: { ...defaults.ui, homeLayout } } })
}

describe('useOrderedThreadKeys', () => {
  it('lists the rows as drawn: by state, with archived work left out', () => {
    useHomeLayoutSetting('classic')
    const { result } = renderHook(() => useOrderedThreadKeys())
    expect(result.current).toEqual([
      'linear:TAV-31',
      'linear:TAV-20',
      `${REPO_ROOT}#tav-14`,
      'session:scratch',
    ])
    act(() => useParkedThreads.getState().park('session:scratch'))
    expect(result.current).toHaveLength(3)
  })

  it('opens and closes a thread, remembering the row', () => {
    act(() => useDeskSelection.getState().openThread('k'))
    expect(useDeskSelection.getState()).toMatchObject({
      selectedThreadKey: 'k',
      openThreadKey: 'k',
    })
    act(() => useDeskSelection.getState().closeThread())
    expect(useDeskSelection.getState()).toMatchObject({
      selectedThreadKey: 'k',
      openThreadKey: null,
    })
  })
})

describe('useOrderedThreadKeys — Tasks layout', () => {
  it('skips the rows of a folded Quiet group in the Tasks layout, until it is shown', () => {
    useHomeLayoutSetting('tasks')
    const { result } = renderHook(() => useOrderedThreadKeys())
    expect(result.current).not.toContain('session:scratch')
    act(() => useDeskSelection.getState().toggleGroup('quiet'))
    expect(result.current).toContain('session:scratch')
  })
})

describe('thread-format', () => {
  it('reads ages as the Last column and as words', () => {
    expect([30_000, 4 * 60_000, 2 * 3_600_000, 86_400_000].map(compactAge)).toEqual([
      'now',
      '4 m',
      '2 h',
      '1 d',
    ])
    expect([0, 3_600_000, 2 * 86_400_000].map(ageInWords)).toEqual(['1 minute', '1 hour', '2 days'])
  })

  it('reads the pull request number, draft state and checks from its facet', () => {
    const pr = pullRequestOf(workThreadOf('linear:TAV-20'))
    expect(pr).toMatchObject({ number: 275, isDraft: false })
    expect(pr?.checks.map((c) => c.state)).toEqual(['failed', 'passed'])
    expect(pullRequestOf(workThreadOf('linear:TAV-31'))).toBeNull()
  })
})

describe('desk-groups', () => {
  it('groups by repo, alphabetically, with unattached terminals together', () => {
    const { result } = renderHook(() => useWorkThreads())
    const groups = deskGroups(result.current.threads, 'repo')
    expect(groups.map((g) => g.label)).toEqual(['Scratch terminals', 'terminator'])
    expect(groups[1].threads).toHaveLength(3)
  })
})

describe('thread-timeline', () => {
  it('lists session starts, answers and pull request changes, newest first', () => {
    const thread = workThreadOf('linear:TAV-20')
    const answeredAt = NOW - 5 * 60_000
    const entries = buildTimeline(thread, {
      'core:answer:building:1': { kind: 'done', at: answeredAt },
      'core:answer:other:1': { kind: 'done', at: NOW },
      'core:answer:building:2': { kind: 'snoozed', at: NOW, until: NOW, signature: '' },
    })
    expect(entries.map((e) => `${e.text} ${e.strong}`)).toEqual([
      'You answered Claude',
      'Pull request #275 checks failing',
      'Started Claude',
    ])
  })

  it('shows the clock time for today and the date for earlier days', () => {
    expect(timelineTime(NOW, NOW)).toMatch(/\d{2}:\d{2}/)
    expect(timelineTime(NOW - 3 * 86_400_000, NOW)).not.toMatch(/:/)
  })
})

describe('what the drawer hands the model and the focus editor', () => {
  it('describes the thread, its sessions and its pull request', () => {
    expect(summaryInputOf(workThreadOf('linear:TAV-20'))).toEqual({
      title: 'PR overview shows status before story',
      ticketKey: 'TAV-20',
      sessions: [
        {
          sessionId: 'building',
          state: 'working',
          lastAssistantTexts: ['Writing ReviewHeader tests'],
          firstUserPrompt: 'Keep the existing risk chip.',
        },
      ],
      pullRequest: { number: 275, isDraft: false, checksLine: '#275 checks failing' },
    })
  })
})

describe('focus options and usage', () => {
  it('names the ticket or the branch a thread points at', () => {
    expect(workKeyOfThread(workThreadOf('linear:TAV-20'))).toEqual({
      tracker: 'linear',
      key: 'TAV-20',
    })
    expect(workKeyOfThread(workThreadOf(`${REPO_ROOT}#tav-14`))).toEqual({
      repoRoot: REPO_ROOT,
      branch: 'tav-14',
    })
  })

  it('states tokens and cost', () => {
    const tokens = { input: 900_000, output: 300_000, cacheCreation: 0, cacheRead: 0 }
    expect(
      usageLabel({ sessionId: 's', tokens, costUsd: 3.1, costIsPartial: false, models: [] })
    ).toBe('1.2M tokens · $3.10')
    expect(
      usageLabel({
        sessionId: 's',
        tokens: { ...tokens, input: 40_000, output: 2_000 },
        costUsd: 0.5,
        costIsPartial: false,
        models: [],
      })
    ).toBe('42k tokens · $0.50')
  })

  it('starts on the Desk', () => {
    expect(useHomeView.getState().view).toBe('desk')
  })
})
