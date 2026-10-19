// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { installElectronApi } from '../../../support/electron-api'

const reveal = vi.hoisted(() => vi.fn())
const answer = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/terminal/navigate-to-session', () => ({ revealSession: reveal }))
vi.mock('../../../../src/renderer/terminal/session-controller', () => ({ answerChoice: answer }))

import {
  openAsk,
  terminalExcerpt,
  replyToSession,
  runAskAction,
  snoozeChoices,
  untilLabel,
} from '../../../../src/renderer/components/home/desk-actions'
import { REVEAL_SESSION_COMMAND, type DeskAsk } from '../../../../src/renderer/home/core-asks'
import { useHomeFeedStore } from '../../../../src/renderer/stores/home-feed.store'
import { useToastStore } from '../../../../src/renderer/stores/toast.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useExtensionCommandsStore } from '../../../../src/renderer/stores/extension-commands.store'

const HOUR = 3_600_000
const MORNING = new Date(2026, 9, 18, 10, 40).getTime()
const EVENING = new Date(2026, 9, 18, 16, 10).getTime()

function ask(patch: Partial<DeskAsk> = {}): DeskAsk {
  return {
    id: 'core:answer:s1:1',
    kind: 'answer',
    source: 'core',
    title: 'Agent is asking',
    detail: 'Run it?',
    facts: [],
    workKey: null,
    since: new Date(MORNING).toISOString(),
    actions: [],
    open: { command: REVEAL_SESSION_COMMAND, args: { sessionId: 's1' } },
    sessionId: 's1',
    ...patch,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('snoozeChoices', () => {
  it('offers an hour, this afternoon at 14:00, and tomorrow at 09:00', () => {
    const [hour, afternoon, tomorrow] = snoozeChoices(MORNING)
    expect(hour).toEqual({ label: '1 hour', until: MORNING + HOUR })
    expect(afternoon).toEqual({
      label: 'This afternoon',
      until: new Date(2026, 9, 18, 14).getTime(),
    })
    expect(tomorrow).toEqual({ label: 'Tomorrow', until: new Date(2026, 9, 19, 9).getTime() })
  })

  it('makes this afternoon three hours on once 14:00 has passed', () => {
    expect(snoozeChoices(EVENING)[1].until).toBe(EVENING + 3 * HOUR)
  })
})

describe('untilLabel', () => {
  it('drops the minutes on the hour and keeps them otherwise', () => {
    expect(untilLabel(new Date(2026, 9, 18, 14).getTime())).toBe('2 PM')
    expect(untilLabel(new Date(2026, 9, 18, 14, 30).getTime())).toBe('2:30 PM')
  })
})

describe('replyToSession', () => {
  it('types the text and presses Enter in that session', () => {
    const input = vi.fn()
    installElectronApi({ terminal: { input } })
    replyToSession('s1', 'use staging')
    expect(input).toHaveBeenCalledWith('s1', 'use staging\r')
  })
})

describe('runAskAction', () => {
  it('answers a numbered choice in the asking session', async () => {
    await runAskAction(ask(), 'choice-2')
    expect(answer).toHaveBeenCalledWith('s1', 2)
  })

  it('brings the session forward to review its changes', async () => {
    await runAskAction(ask({ kind: 'finished' }), 'review-changes')
    expect(reveal).toHaveBeenCalledWith('s1')
  })

  it("hands an extension's ask back to the extension that published it", async () => {
    const runAction = vi.fn().mockResolvedValue(true)
    useHomeFeedStore.setState({ runAction })
    await runAskAction(
      ask({ source: 'git-integration', id: 'fix:1', sessionId: undefined }),
      'send-to-agent'
    )
    expect(runAction).toHaveBeenCalledWith('git-integration', 'fix:1', 'send-to-agent')
    expect(answer).not.toHaveBeenCalled()
  })
})

describe('openAsk', () => {
  it('reveals the session of a core ask', async () => {
    await openAsk(ask())
    expect(reveal).toHaveBeenCalledWith('s1')
  })

  it("runs an extension ask's open command, found by id within its extension", async () => {
    const executeCommand = vi.fn()
    installElectronApi({ extension: { executeCommand } })
    useExtensionCommandsStore.setState({
      refresh: vi.fn().mockResolvedValue(undefined),
      registered: [{ key: 'foundry.k1', extensionId: 'foundry', id: 'open-order', label: 'Open' }],
    })
    const extensionAsk = ask({
      source: 'foundry',
      sessionId: undefined,
      open: { command: 'open-order', args: { orderId: 'o1' } },
    })
    await openAsk(extensionAsk)
    expect(executeCommand).toHaveBeenCalledWith(
      'foundry.k1',
      { projectId: null, sessionId: null, repoRoot: null },
      { orderId: 'o1' }
    )
  })
})

describe('terminalExcerpt', () => {
  const showTerminalRows = (rows: string[]) =>
    useSessionStore.setState({
      getTerminalInstance: () => ({ readVisibleRows: () => rows }) as never,
    })

  it('keeps the last 14 used lines and drops the blank rows under them', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`)
    showTerminalRows([...lines, '', '  ', ''])
    const excerpt = terminalExcerpt('s1')
    expect(excerpt).toHaveLength(14)
    expect(excerpt[0]).toBe('line 7')
    expect(excerpt.at(-1)).toBe('line 20')
  })

  it('is empty for a screen of blank rows and for no session', () => {
    showTerminalRows(['', ''])
    expect(terminalExcerpt('s1')).toEqual([])
    expect(terminalExcerpt(undefined)).toEqual([])
  })
})

describe('openAsk — nothing to run it', () => {
  it('says so in plain words', async () => {
    useExtensionCommandsStore.setState({
      refresh: vi.fn().mockResolvedValue(undefined),
      registered: [],
    })
    await openAsk(ask({ source: 'foundry', sessionId: undefined, open: { command: 'gone' } }))
    expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
      'Could not open this: the extension that sent it is not running.'
    )
  })
})
