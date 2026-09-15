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

  it('orders a group needs-you, working, idle, exited, and most recent first within a state', () => {
    const groups = buildLedger(
      [
        personal('idle', { state: 'idle', lastActivityAt: 9 }),
        personal('exited', { state: 'exited', lastActivityAt: 10 }),
        personal('work-old', { state: 'working', lastActivityAt: 1 }),
        personal('needs', { state: 'awaiting-input', lastActivityAt: 0 }),
        personal('work-new', { state: 'working', lastActivityAt: 5 }),
      ],
      DEFAULT_HOME_PREFS,
      NO_FILTERS,
      titles
    )
    expect(shape(groups)[0][1]).toEqual(['needs', 'work-new', 'work-old', 'idle', 'exited'])
  })

  it('draws no group at all when there are no sessions', () => {
    expect(buildLedger([], DEFAULT_HOME_PREFS, NO_FILTERS, titles)).toEqual([])
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
    personal('p-idle', { state: 'idle', lastActivityAt: 3 }),
    northwind('n-needs', { state: 'awaiting-input', lastActivityAt: 1 }),
    personal('p-exited', { state: 'exited', lastActivityAt: 7 }),
    northwind('n-work', { state: 'working', lastActivityAt: 5, projectName: 'northwind-web' }),
    personal('p-closed', { isClosed: true, state: 'exited', closedAt: '2026-09-15T00:00:00.000Z' }),
  ]

  it('groups by project alone', () => {
    const groups = buildLedger(
      facts,
      { ...DEFAULT_HOME_PREFS, groupBy: 'project' },
      NO_FILTERS,
      titles
    )
    expect(groups.map((g) => g.label)).toEqual([
      'northwind-api',
      'northwind-web',
      'terminator',
      'Closed',
    ])
  })

  it('draws one group of open sessions when grouping is off', () => {
    const groups = buildLedger(
      facts,
      { ...DEFAULT_HOME_PREFS, groupBy: 'none' },
      NO_FILTERS,
      titles
    )
    expect(shape(groups)).toEqual([
      ['All sessions', ['n-needs', 'n-work', 'p-idle', 'p-exited']],
      ['Closed', ['p-closed']],
    ])
  })

  it('sorts by most recent activity when asked', () => {
    const groups = buildLedger(
      facts,
      { ...DEFAULT_HOME_PREFS, groupBy: 'none', sort: 'recent' },
      NO_FILTERS,
      titles
    )
    expect(shape(groups)[0][1]).toEqual(['p-exited', 'n-work', 'p-idle', 'n-needs'])
  })

  it('hides sessions whose process exited, but keeps closed history', () => {
    const groups = buildLedger(
      facts,
      { ...DEFAULT_HOME_PREFS, groupBy: 'none', hideExited: true },
      NO_FILTERS,
      titles
    )
    expect(shape(groups)).toEqual([
      ['All sessions', ['n-needs', 'n-work', 'p-idle']],
      ['Closed', ['p-closed']],
    ])
  })

  it('shows only sessions that need you when that filter is on', () => {
    const groups = buildLedger(facts, DEFAULT_HOME_PREFS, { needsYou: true, text: '' }, titles)
    expect(shape(groups)).toEqual([['Northwind / northwind-api', ['n-needs']]])
  })
})
