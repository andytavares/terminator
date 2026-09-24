import { describe, it, expect } from 'vitest'
import { buildLedger, NO_FILTERS } from '../../../../src/renderer/sidebar/ledger-rows'
import { DEFAULT_HOME_PREFS } from '../../../../src/renderer/sidebar/home-prefs'
import { fact } from './fixtures/facts'

const titles = new Map<string, string>()
const shape = (groups: ReturnType<typeof buildLedger>) =>
  groups.map((g) => [g.label, g.facts.map((f) => f.sessionId)])

const personal = (id: string, patch = {}) =>
  fact({ sessionId: id, workspaceName: 'Personal', projectName: 'terminator', ...patch })
const northwind = (id: string, patch = {}) =>
  fact({ sessionId: id, workspaceName: 'Northwind', projectName: 'northwind-api', ...patch })

describe('buildLedger — default grouping and order (US1)', () => {
  it('groups by workspace and project, labelled "<workspace> / <project>"', () => {
    const groups = buildLedger(
      [personal('a'), northwind('b'), personal('c')],
      DEFAULT_HOME_PREFS,
      NO_FILTERS,
      titles
    )
    expect(shape(groups)).toEqual([
      ['Northwind / northwind-api', ['b']],
      ['Personal / terminator', ['a', 'c']],
    ])
  })

  it('puts a session with no project in a last "No branch" group', () => {
    const groups = buildLedger(
      [
        fact({ sessionId: 'scratch', projectId: null, workspaceName: null, projectName: null }),
        personal('a'),
      ],
      DEFAULT_HOME_PREFS,
      NO_FILTERS,
      titles
    )
    expect(shape(groups)).toEqual([
      ['Personal / terminator', ['a']],
      ['No branch', ['scratch']],
    ])
  })

  it('lifts awaiting-input sessions into a Needs you group, and orders the rest by standing then startedAt', () => {
    const T1 = '2026-09-15T10:00:00.000Z'
    const T2 = '2026-09-15T10:01:00.000Z'
    const T3 = '2026-09-15T10:02:00.000Z'
    const T4 = '2026-09-15T10:03:00.000Z'
    const groups = buildLedger(
      [
        personal('idle', { state: 'idle', startedAt: T3 }),
        personal('exited', { state: 'exited', startedAt: T4 }),
        personal('work-old', { state: 'working', startedAt: T1 }),
        personal('needs', { state: 'awaiting-input', startedAt: T1 }),
        personal('work-new', { state: 'working', startedAt: T2 }),
      ],
      DEFAULT_HOME_PREFS,
      NO_FILTERS,
      titles
    )
    expect(shape(groups)).toEqual([
      ['Needs you', ['needs']],
      ['Personal / terminator', ['work-old', 'work-new', 'idle', 'exited']],
    ])
  })

  it('draws no group at all when there are no sessions', () => {
    expect(buildLedger([], DEFAULT_HOME_PREFS, NO_FILTERS, titles)).toEqual([])
  })

  it('does not move a running session when its lastActivityAt changes', () => {
    const T1 = '2026-09-15T10:00:00.000Z'
    const T2 = '2026-09-15T10:01:00.000Z'
    const before = [
      personal('r1', { state: 'working', startedAt: T1, lastActivityAt: 100 }),
      personal('r2', { state: 'idle', startedAt: T2, lastActivityAt: 200 }),
    ]
    const beforeOrder = shape(buildLedger(before, DEFAULT_HOME_PREFS, NO_FILTERS, titles))[0][1]
    const swapped = before.map((f) => ({ ...f, lastActivityAt: f.sessionId === 'r1' ? 999 : 1 }))
    const afterOrder = shape(buildLedger(swapped, DEFAULT_HOME_PREFS, NO_FILTERS, titles))[0][1]
    expect(afterOrder).toEqual(beforeOrder)
  })

  it('does not move a session when it flips from working to idle', () => {
    const T1 = '2026-09-15T10:00:00.000Z'
    const T2 = '2026-09-15T10:01:00.000Z'
    const before = [
      personal('r1', { state: 'working', startedAt: T1 }),
      personal('r2', { state: 'idle', startedAt: T2 }),
    ]
    const beforeOrder = shape(buildLedger(before, DEFAULT_HOME_PREFS, NO_FILTERS, titles))[0][1]
    const flipped = before.map((f) => (f.sessionId === 'r1' ? { ...f, state: 'idle' as const } : f))
    const afterOrder = shape(buildLedger(flipped, DEFAULT_HOME_PREFS, NO_FILTERS, titles))[0][1]
    expect(afterOrder).toEqual(beforeOrder)
  })

  it('moves a session into the Needs you group when it becomes awaiting-input', () => {
    const T1 = '2026-09-15T10:00:00.000Z'
    const T2 = '2026-09-15T10:01:00.000Z'
    const before = [
      personal('r1', { state: 'working', startedAt: T1 }),
      personal('r2', { state: 'idle', startedAt: T2 }),
    ]
    const flipped = before.map((f) =>
      f.sessionId === 'r1' ? { ...f, state: 'awaiting-input' as const } : f
    )
    const groups = shape(buildLedger(flipped, DEFAULT_HOME_PREFS, NO_FILTERS, titles))
    expect(groups).toEqual([
      ['Needs you', ['r1']],
      ['Personal / terminator', ['r2']],
    ])
  })
})

describe('buildLedger — closed sessions and the text filter (US2)', () => {
  const closed = (id: string, closedAt: string, patch = {}) =>
    personal(id, { isClosed: true, state: 'exited', closedAt, ...patch })

  it('files closed sessions in a final Closed group, most recently closed first', () => {
    const groups = buildLedger(
      [
        closed('older', '2026-09-14T10:00:00.000Z'),
        personal('open'),
        closed('newer', '2026-09-15T10:00:00.000Z'),
      ],
      DEFAULT_HOME_PREFS,
      NO_FILTERS,
      titles
    )
    expect(shape(groups)).toEqual([
      ['Personal / terminator', ['open']],
      ['Closed', ['newer', 'older']],
    ])
  })

  it('filters open and closed sessions alike', () => {
    const groups = buildLedger(
      [
        closed('ghostty', '2026-09-15T10:00:00.000Z', { description: 'Ghostty keybinds' }),
        personal('other', { description: 'Something else' }),
      ],
      DEFAULT_HOME_PREFS,
      { needsYou: false, text: 'ghostty' },
      titles
    )
    expect(shape(groups)).toEqual([['Closed', ['ghostty']]])
  })
})

describe('buildLedger — display options (US7)', () => {
  const facts = [
    personal('p-idle', { state: 'idle', lastActivityAt: 3, lastAttendedAt: 300 }),
    northwind('n-needs', { state: 'awaiting-input', lastActivityAt: 1, lastAttendedAt: 100 }),
    personal('p-exited', { state: 'exited', lastActivityAt: 7, lastAttendedAt: 700 }),
    northwind('n-work', {
      state: 'working',
      lastActivityAt: 5,
      lastAttendedAt: 500,
      projectName: 'northwind-web',
    }),
    personal('p-closed', { isClosed: true, state: 'exited', closedAt: '2026-09-15T00:00:00.000Z' }),
  ]

  it('groups by project alone, lifting the needs-you session out first', () => {
    const groups = buildLedger(
      facts,
      { ...DEFAULT_HOME_PREFS, groupBy: 'project' },
      NO_FILTERS,
      titles
    )
    expect(groups.map((g) => g.label)).toEqual([
      'Needs you',
      'northwind-web',
      'terminator',
      'Closed',
    ])
  })

  it('draws one group of open sessions when grouping is off, needs-you still lifted', () => {
    const groups = buildLedger(
      facts,
      { ...DEFAULT_HOME_PREFS, groupBy: 'none' },
      NO_FILTERS,
      titles
    )
    expect(shape(groups)).toEqual([
      ['Needs you', ['n-needs']],
      ['All sessions', ['p-idle', 'n-work', 'p-exited']],
      ['Closed', ['p-closed']],
    ])
  })

  it('sorts by when each session was last opened, null last, when asked', () => {
    const groups = buildLedger(
      facts,
      { ...DEFAULT_HOME_PREFS, groupBy: 'none', sort: 'recent' },
      NO_FILTERS,
      titles
    )
    expect(shape(groups)[0][1]).toEqual(['p-exited', 'n-work', 'p-idle', 'n-needs'])
  })

  it('orders never-opened sessions by start, and equal open times by start', () => {
    const at = (id: string, lastAttendedAt: number | null, startedAt: string) =>
      personal(id, { lastAttendedAt, startedAt })
    const groups = buildLedger(
      [
        at('never-late', null, '2026-09-15T12:00:00.000Z'),
        at('tie-late', 50, '2026-09-15T11:00:00.000Z'),
        at('never-early', null, '2026-09-15T09:00:00.000Z'),
        at('tie-early', 50, '2026-09-15T08:00:00.000Z'),
        at('newest', 90, '2026-09-15T13:00:00.000Z'),
      ],
      { ...DEFAULT_HOME_PREFS, groupBy: 'none', sort: 'recent' },
      NO_FILTERS,
      titles
    )
    expect(shape(groups)[0][1]).toEqual([
      'newest',
      'tie-early',
      'tie-late',
      'never-early',
      'never-late',
    ])
  })

  it('labels a project with no workspace under "No branch / <project>", sorted by name', () => {
    const groups = buildLedger(
      [fact({ sessionId: 'orphan', workspaceName: null, projectName: 'loose' }), personal('a')],
      DEFAULT_HOME_PREFS,
      NO_FILTERS,
      titles
    )
    expect(shape(groups)).toEqual([
      ['No branch / loose', ['orphan']],
      ['Personal / terminator', ['a']],
    ])
  })

  it('keeps "No branch" last whichever side of the comparison it lands on', () => {
    const scratch = (id: string) =>
      fact({ sessionId: id, projectId: null, workspaceName: null, projectName: null })
    const groups = buildLedger(
      [personal('a'), scratch('s'), northwind('b')],
      DEFAULT_HOME_PREFS,
      NO_FILTERS,
      titles
    )
    expect(shape(groups).map(([label]) => label)).toEqual([
      'Northwind / northwind-api',
      'Personal / terminator',
      'No branch',
    ])
  })

  it('hides sessions whose process exited, but keeps closed history', () => {
    const groups = buildLedger(
      facts,
      { ...DEFAULT_HOME_PREFS, groupBy: 'none', hideExited: true },
      NO_FILTERS,
      titles
    )
    expect(shape(groups)).toEqual([
      ['Needs you', ['n-needs']],
      ['All sessions', ['p-idle', 'n-work']],
      ['Closed', ['p-closed']],
    ])
  })

  it('shows only sessions that need you when that filter is on', () => {
    const groups = buildLedger(facts, DEFAULT_HOME_PREFS, { needsYou: true, text: '' }, titles)
    expect(shape(groups)).toEqual([['Needs you', ['n-needs']]])
  })
})
