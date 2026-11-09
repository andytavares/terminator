import { describe, it, expect, beforeEach } from 'vitest'
import { useNavigationStore, type NavigationEntry } from '../../../../src/stores/navigation.store'

function entry(projectId: string): NavigationEntry {
  return {
    globalTabId: null,
    workspaceTabId: null,
    projectTabId: null,
    projectId,
    sessionId: null,
  }
}

const navigation = () => useNavigationStore.getState()

beforeEach(() => useNavigationStore.setState(useNavigationStore.getInitialState(), true))

describe('navigation history — recording', () => {
  it('records each change in order', () => {
    navigation().record(entry('a'))
    navigation().record(entry('b'))
    expect(navigation().entries.map((e) => e.projectId)).toEqual(['a', 'b'])
    expect(navigation().cursor).toBe(1)
  })

  it('skips an entry equal to the current one', () => {
    navigation().record(entry('a'))
    navigation().record(entry('a'))
    expect(navigation().entries).toHaveLength(1)
  })
})

describe('navigation history — moving', () => {
  it('steps back and forward without recording, and stops at the ends', () => {
    navigation().record(entry('a'))
    navigation().record(entry('b'))
    expect(navigation().step(-1)?.projectId).toBe('a')
    expect(navigation().step(-1)).toBeNull()
    expect(navigation().step(1)?.projectId).toBe('b')
    expect(navigation().step(1)).toBeNull()
    expect(navigation().entries).toHaveLength(2)
  })

  it('drops the forward entries when a new one is recorded after going back', () => {
    useNavigationStore.setState({ entries: [entry('a'), entry('b'), entry('c')], cursor: 2 })
    navigation().step(-1)
    navigation().step(-1)
    navigation().record(entry('d'))
    expect(navigation().entries.map((e) => e.projectId)).toEqual(['a', 'd'])
  })

  it('keeps the last 50 entries', () => {
    const full = Array.from({ length: 50 }, (_, i) => entry(`p${i}`))
    useNavigationStore.setState({ entries: full, cursor: 49 })
    navigation().record(entry('p50'))
    expect(navigation().entries).toHaveLength(50)
    expect(navigation().entries[0].projectId).toBe('p1')
    expect(navigation().entries[49].projectId).toBe('p50')
    expect(navigation().cursor).toBe(49)
  })
})

describe('closed tabs', () => {
  const closed = (n: number) => ({ projectId: 'p', cwd: `/dir${n}`, title: `T${n}` })

  it('gives back the most recently closed tab first', () => {
    navigation().rememberClosed(closed(1))
    navigation().rememberClosed(closed(2))
    expect(navigation().takeClosed()?.title).toBe('T2')
    expect(navigation().takeClosed()?.title).toBe('T1')
    expect(navigation().takeClosed()).toBeUndefined()
  })

  it('keeps the last 10', () => {
    useNavigationStore.setState({ closedTabs: Array.from({ length: 10 }, (_, i) => closed(i)) })
    navigation().rememberClosed(closed(10))
    expect(navigation().closedTabs).toHaveLength(10)
    expect(navigation().closedTabs[0].title).toBe('T1')
    expect(navigation().closedTabs[9].title).toBe('T10')
  })
})
