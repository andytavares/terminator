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

describe('attachSessions', () => {
  beforeEach(() => {
    installElectronApi({ agents: { history: async () => ({ data: [] }) } })
    const agent = partialFake<NonNullable<SessionRecordListing['agent']>>({
      agentId: 'claude',
      transcriptPath: '/t/found.jsonl',
    })
    const found = partialFake<SessionRecordListing>({ tabTitle: 'Found', branch: null, agent })
    useSessionStore.setState({ sessions: new Map(), terminalInstances: new Map() })
    useSessionRecordsStore.setState({ records: new Map([['found', found]]) })
  })

  it('attaches each session that has a conversation, without a toast', async () => {
    await attachSessions('tab', ['found'])
    expect(attachedTo('tab').sessions.map((s) => s.title)).toEqual(['Found'])
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('says so when a session has no conversation, and still attaches the others', async () => {
    await attachSessions('tab', ['missing', 'found'])
    expect(attachedTo('tab').sessions.map((s) => s.sessionId)).toEqual(['found'])
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([
      'This session has no conversation to attach.',
    ])
  })

  it('ignores the tab dropped on itself', async () => {
    await attachSessions('found', ['found'])
    expect(attachedTo('found')).toBe(noAttachedContext)
    expect(useToastStore.getState().toasts).toEqual([])
  })
})
