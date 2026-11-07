import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render } from '@testing-library/react'
import { McpHost } from '../../../../src/renderer/mcp/McpHost'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { installElectronApi, pushedEvent } from '../../../support/electron-api'
import type { McpAnswer, McpCall } from '../../../../src/shared/mcp/renderer-tools'
import type { PaletteInputs } from '../../../../src/renderer/components/QuickActionsHost'
import type { TerminalSession } from '../../../../src/shared/types/index'

const revealSession = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/terminal/navigate-to-session', () => ({ revealSession }))
// The palette's own hooks read every store; here the list is the one thing the host needs.
vi.mock('../../../../src/renderer/components/QuickActionsHost', () => ({
  usePaletteState: () => ({
    actions: [
      { id: 'core.clear', label: 'Clear', group: 'terminal', destructive: true, run: () => {} },
    ],
  }),
}))

const palette = {} as PaletteInputs
let calls: ReturnType<typeof pushedEvent<[McpCall]>>
let answered: Promise<McpAnswer>

beforeEach(() => {
  calls = pushedEvent<[McpCall]>()
  let resolve: (answer: McpAnswer) => void
  answered = new Promise((r) => (resolve = r))
  installElectronApi({
    mcp: { onCall: calls.addListener, answer: async (answer) => resolve(answer) },
    extension: {
      getCommands: async () => ({ commands: [] }),
      list: async () => ({ extensions: [] }),
    },
  })
  useSessionStore.setState({
    sessions: new Map([['s-1', { id: 's-1', projectId: 'p-1' } as TerminalSession]]),
  })
})

/** Delivers one call as main would and waits for the renderer's answer. */
async function deliver(call: McpCall): Promise<McpAnswer> {
  // The answer can need a render, which act only flushes once its callback returns.
  await act(async () => calls.deliver(call))
  return answered
}

describe('McpHost', () => {
  it('runs a call from main and answers it with the same id', async () => {
    render(<McpHost palette={palette} />)
    const answer = await deliver({ id: 'c-7', tool: 'open_session', args: { sessionId: 's-1' } })
    expect(answer).toEqual({ id: 'c-7', result: { sessionId: 's-1' } })
    expect(revealSession).toHaveBeenCalledWith('s-1')
  })

  it('answers a call with bad arguments with an error', async () => {
    render(<McpHost palette={palette} />)
    const answer = await deliver({ id: 'c-8', tool: 'open_session', args: {} })
    expect(answer).toEqual({ id: 'c-8', error: 'These arguments are missing or wrong: sessionId.' })
  })

  it('answers a tool it does not know with an error', async () => {
    render(<McpHost palette={palette} />)
    const answer = await deliver({ id: 'c-9', tool: 'nope' as McpCall['tool'], args: {} })
    expect(answer).toEqual({ id: 'c-9', error: 'Terminator has no tool named nope.' })
  })

  it('answers a quick-action call from the list the palette shows', async () => {
    render(<McpHost palette={palette} />)
    const answer = await deliver({ id: 'c-10', tool: 'list_quick_actions', args: {} })
    expect(answer).toMatchObject({ id: 'c-10', result: [{ id: 'core.clear', destructive: true }] })
  })

  it('stops listening when it unmounts', () => {
    const { unmount } = render(<McpHost palette={palette} />)
    unmount()
    expect(calls.listening).toBe(false)
  })
})
