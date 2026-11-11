// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import { pasteSessionContext, runsAgent } from '../../../../src/components/terminal/session-paste'
import { useSessionStore } from '../../../../src/stores/session.store'
import { useSessionRecordsStore } from '../../../../src/stores/session-records.store'
import { useToastStore } from '../../../../src/stores/toast.store'
import { recordUse } from '../../../../src/usage/record'
import type { TerminalInstance } from '../../../../src/components/terminal/TerminalSession'
import type {
  SessionRecordListing,
  TerminalSession,
} from '../../../../../core-shared/src/types/index'
import { terminalSessionOf } from '../../../../../test-support/src/renderer-stores'
import { partialFake } from '../../../../../test-support/src/fakes'

const claudeRecord = (tabTitle: string): SessionRecordListing =>
  partialFake<SessionRecordListing>({
    tabTitle,
    branch: 'main',
    agent: partialFake<NonNullable<SessionRecordListing['agent']>>({
      agentId: 'claude',
      transcriptPath: `/t/${tabTitle}.jsonl`,
    }),
  })

/** The `cli` terminal, with `patch` on its session, and the records given. */
function place(patch: Partial<TerminalSession>, records: [string, SessionRecordListing][] = []) {
  const paste = vi.fn()
  useSessionStore.setState({
    sessions: new Map([['cli', terminalSessionOf({ id: 'cli', projectId: 'p1', ...patch })]]),
    terminalInstances: new Map([
      ['cli', partialFake<TerminalInstance>({ terminal: partialFake<Terminal>({ paste }) })],
    ]),
  })
  useSessionRecordsStore.setState({ records: new Map(records) })
  return paste
}

beforeEach(() => {
  vi.clearAllMocks()
  useToastStore.setState({ toasts: [] })
})

describe('runsAgent', () => {
  it.each([
    { name: 'a terminal whose hooks reported a turn', patch: { agentTurn: false }, runs: true },
    { name: 'a plain shell', patch: {}, runs: false },
    { name: 'a closed terminal', patch: { agentTurn: false, status: 'closed' }, runs: false },
    { name: 'an agent tab', patch: { agentTurn: false, surface: 'agent' }, runs: false },
  ] as const)('$name runs an agent: $runs', ({ patch, runs }) => {
    place(patch)
    expect(runsAgent('cli')).toBe(runs)
  })

  it('counts a terminal whose record names an agent', () => {
    place({}, [['cli', claudeRecord('cli')]])
    expect(runsAgent('cli')).toBe(true)
  })
})

describe('pasteSessionContext', () => {
  it("pastes one context block for the carried sessions, leaving out the terminal's own", async () => {
    const paste = place({ agentTurn: false }, [
      ['cli', claudeRecord('cli')],
      ['login', claudeRecord('login')],
    ])
    await pasteSessionContext('cli', ['login', 'cli'])
    expect(paste).toHaveBeenCalledTimes(1)
    const pasted = paste.mock.calls[0][0] as string
    expect(pasted.startsWith('<terminator_context>\n')).toBe(true)
    expect(pasted).toContain('/t/login.jsonl')
    expect(pasted).not.toContain('/t/cli.jsonl')
    expect(recordUse).toHaveBeenCalledWith('core.terminal.paste-session-context')
  })

  it('pastes nothing and says so when no carried session has context', async () => {
    const paste = place({ agentTurn: false })
    await pasteSessionContext('cli', ['missing'])
    expect(paste).not.toHaveBeenCalled()
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      'Nothing to paste: these sessions have no conversation or output.',
    ])
  })
})
