// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  attachSessions,
  attachedOf,
  useAttachedContextStore,
} from '../../../../src/stores/attached-context.store'
import {
  noAttachedContext,
  type Citation,
  type SessionContext,
} from '../../../../src/components/agent/attached-context'
import { useSessionStore } from '../../../../src/stores/session.store'
import { useSessionRecordsStore } from '../../../../src/stores/session-records.store'
import { useToastStore } from '../../../../src/stores/toast.store'
import { terminalSessionOf } from '../../../../../test-support/src/renderer-stores'
import type { SessionRecordListing } from '../../../../../core-shared/src/types/index'
import { installElectronApi } from '../../../../../test-support/src/electron-api'
import { partialFake } from '../../../../../test-support/src/fakes'

const context = (sessionId: string): SessionContext => ({
  sessionId,
  title: sessionId,
  branch: null,
  source: { kind: 'transcript', agentId: 'claude', path: `/t/${sessionId}.jsonl` },
})

const cite = (quote: string): Citation => ({ entryIndex: 2, quote, comment: '' })

const store = () => useAttachedContextStore.getState()
const attachedTo = (tabId: string) => attachedOf(tabId)(store())

beforeEach(() => {
  useAttachedContextStore.setState({ byTab: new Map(), sendRequests: new Map() })
  useToastStore.setState({ toasts: [] })
})

describe('attached context store — sessions', () => {
  it('reads one stable empty value for a tab with nothing attached', () => {
    expect(attachedTo('tab')).toBe(noAttachedContext)
    expect(attachedTo('other')).toBe(attachedTo('tab'))
  })

  it('adds sessions once each and never the tab itself', () => {
    store().addSessions('tab', [context('a'), context('tab'), context('a')])
    store().addSessions('tab', [context('a'), context('b')])
    expect(attachedTo('tab').sessions.map((s) => s.sessionId)).toEqual(['a', 'b'])
  })

  it('removes one session', () => {
    store().addSessions('tab', [context('a'), context('b')])
    store().removeSession('tab', 'a')
    expect(attachedTo('tab').sessions.map((s) => s.sessionId)).toEqual(['b'])
  })
})

describe('attached context store — citations, tabs and sends', () => {
  it('adds, edits and removes citations by position', () => {
    store().addCitation('tab', cite('one'))
    store().addCitation('tab', cite('two'))
    store().updateCitation('tab', 1, 'shorter')
    expect(attachedTo('tab').citations).toEqual([
      cite('one'),
      { ...cite('two'), comment: 'shorter' },
    ])
    store().removeCitation('tab', 0)
    expect(attachedTo('tab').citations).toEqual([{ ...cite('two'), comment: 'shorter' }])
  })

  it('keeps each tab apart, and clear empties only that tab', () => {
    store().addCitation('tab', cite('one'))
    store().set('other', { sessions: [context('a')], citations: [] })
    store().clear('tab')
    expect(attachedTo('tab')).toBe(noAttachedContext)
    expect(attachedTo('other').sessions).toEqual([context('a')])
  })

  it('counts send requests per tab', () => {
    store().requestSend('tab')
    store().requestSend('tab')
    expect(store().sendRequests.get('tab')).toBe(2)
    expect(store().sendRequests.get('other')).toBeUndefined()
  })
})

function seedSessions(): void {
  installElectronApi({ agents: { history: async () => ({ data: [] }) } })
  const agent = partialFake<NonNullable<SessionRecordListing['agent']>>({
    agentId: 'claude',
    transcriptPath: '/t/found.jsonl',
  })
  const found = partialFake<SessionRecordListing>({ tabTitle: 'Found', branch: null, agent })
  const shell = terminalSessionOf({ id: 'shell', projectId: 'p1', tabTitle: 'Build shell' })
  const server = terminalSessionOf({ id: 'server', projectId: 'p1', tabTitle: 'Dev server' })
  useSessionStore.setState({
    sessions: new Map([
      ['shell', shell],
      ['server', server],
    ]),
    terminalInstances: new Map(),
  })
  useSessionRecordsStore.setState({ records: new Map([['found', found]]) })
}

const toastMessages = () => useToastStore.getState().toasts.map((t) => t.message)

describe('attachSessions', () => {
  beforeEach(seedSessions)

  it('attaches each session that has a conversation, without a toast', async () => {
    await attachSessions('tab', ['found'])
    expect(attachedTo('tab').sessions.map((s) => s.title)).toEqual(['Found'])
    expect(toastMessages()).toEqual([])
  })

  it('ignores the tab dropped on itself', async () => {
    await attachSessions('found', ['found'])
    expect(attachedTo('found')).toBe(noAttachedContext)
    expect(toastMessages()).toEqual([])
  })
})

describe('attachSessions — sessions with no conversation or output', () => {
  beforeEach(seedSessions)

  it('counts what it attached and names the session with nothing, leaving out the tab', async () => {
    await attachSessions('tab', ['tab', 'shell', 'found'])
    expect(attachedTo('tab').sessions.map((s) => s.sessionId)).toEqual(['found'])
    expect(toastMessages()).toEqual([
      'Attached 1 of 2 sessions. Build shell had no conversation or output.',
    ])
  })

  it('counts a session it cannot name as one session', async () => {
    await attachSessions('tab', ['missing', 'found'])
    expect(toastMessages()).toEqual([
      'Attached 1 of 2 sessions. 1 session had no conversation or output.',
    ])
  })

  it('says nothing was attached, naming every session, when none had anything', async () => {
    await attachSessions('tab', ['shell', 'server'])
    expect(attachedTo('tab')).toBe(noAttachedContext)
    expect(toastMessages()).toEqual([
      'Nothing attached: Build shell and Dev server had no conversation or output.',
    ])
  })
})
