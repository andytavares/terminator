import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { PermissionQueue } from '../../src/components/PermissionQueue.js'
import type { PendingAskView } from '../../src/types/electron.js'

// A phase holds every tool call at a PreToolUse hook until somebody decides.
// This is where they decide. Without it the request goes back to the terminal
// after five minutes, which works but makes the console a spectator of its own
// agents.

const ask = (over: Partial<PendingAskView> = {}): PendingAskView => ({
  featureDir: '/repo/specs/021-thing',
  sessionId: 'session-1',
  requestId: 'req-1',
  toolName: 'Bash',
  summary: 'redis-cli -h prod-cache-01',
  detail: 'command: redis-cli -h prod-cache-01\ndescription: check the cache',
  at: 1_000,
  ...over,
})

function panel(over: Partial<React.ComponentProps<typeof PermissionQueue>> = {}) {
  const props = {
    pending: [ask()],
    onAllow: vi.fn(),
    onDeny: vi.fn(),
    onAnswer: vi.fn(),
    onHandBack: vi.fn(),
    ...over,
  }
  render(<PermissionQueue {...props} />)
  return props
}

describe('when nothing is waiting', () => {
  it('says so, rather than rendering an empty box', () => {
    // An empty panel and a panel that failed to load look identical otherwise.
    panel({ pending: [] })
    expect(screen.getByText(/Nothing is waiting on you/)).toBeDefined()
  })
})

describe('showing what is actually being asked', () => {
  it('leads with the request, not the name of the tool making it', () => {
    panel()
    expect(screen.getByText('redis-cli -h prod-cache-01')).toBeDefined()
  })

  it('names the tool as well', () => {
    panel()
    expect(screen.getByText('Bash')).toBeDefined()
  })

  it('names the card, since a request can come from any of them', () => {
    panel({ cardLabel: () => 'FLU-220 Unify session identity' })
    expect(screen.getByText('FLU-220 Unify session identity')).toBeDefined()
  })

  it('falls back to the card directory when nothing names it better', () => {
    panel()
    expect(screen.getByText('021-thing')).toBeDefined()
  })

  it('flags a host that is not on the allowlist', () => {
    panel({ pending: [ask({ targetHost: 'prod-cache-01' })] })
    expect(screen.getByText('prod-cache-01')).toBeDefined()
  })

  it('shows the whole request on request — approving a title approves what it elides', () => {
    panel()
    expect(screen.queryByText(/description: check the cache/)).toBeNull()
    fireEvent.click(screen.getByText('Show the full request'))
    expect(screen.getByText(/description: check the cache/)).toBeDefined()
  })

  it('offers nothing to expand when there is no more to show', () => {
    panel({ pending: [ask({ detail: null })] })
    expect(screen.queryByText('Show the full request')).toBeNull()
  })

  it('counts what is waiting, so the queue is not a surprise', () => {
    panel({ pending: [ask(), ask({ requestId: 'req-2' })] })
    expect(screen.getByText(/2 runs are waiting on you/)).toBeDefined()
  })

  it('renders them in the order given, which is oldest first', () => {
    panel({
      pending: [
        ask({ requestId: 'a', summary: 'first ask' }),
        ask({ requestId: 'b', summary: 'second ask' }),
      ],
    })
    const rendered = screen.getAllByText(/ask$/).map((node) => node.textContent)
    expect(rendered).toEqual(['first ask', 'second ask'])
  })
})

describe('answering', () => {
  it('allows it', () => {
    const props = panel()
    fireEvent.click(screen.getByText('Allow'))
    expect(props.onAllow).toHaveBeenCalledWith('req-1')
  })

  it('denies it', () => {
    const props = panel()
    fireEvent.click(screen.getByText('Deny'))
    expect(props.onDeny).toHaveBeenCalledWith('req-1')
  })

  it('sends real words back, for an ask that is not a yes or a no', () => {
    const props = panel()
    fireEvent.change(screen.getByLabelText('Answer Bash'), {
      target: { value: 'use the staging host' },
    })
    fireEvent.click(screen.getByText('Send'))
    expect(props.onAnswer).toHaveBeenCalledWith('req-1', 'use the staging host')
  })

  it('sends on Enter, because that is what the box invites', () => {
    const props = panel()
    const box = screen.getByLabelText('Answer Bash')
    fireEvent.change(box, { target: { value: 'try staging' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(props.onAnswer).toHaveBeenCalledWith('req-1', 'try staging')
  })

  it('sends nothing for an empty answer', () => {
    const props = panel()
    fireEvent.click(screen.getByText('Send'))
    expect(props.onAnswer).not.toHaveBeenCalled()
  })

  it('sends nothing for an answer that is only whitespace', () => {
    const props = panel()
    fireEvent.change(screen.getByLabelText('Answer Bash'), { target: { value: '   ' } })
    fireEvent.click(screen.getByText('Send'))
    expect(props.onAnswer).not.toHaveBeenCalled()
  })

  it('hands it back to the terminal, to answer where the agent is', () => {
    const props = panel()
    fireEvent.click(screen.getByText('Answer in terminal'))
    expect(props.onHandBack).toHaveBeenCalledWith('req-1')
  })
})

describe('an ask that is a question rather than a permission', () => {
  const question = ask({
    toolName: 'AskUserQuestion',
    summary: 'Which scope should this cover?',
    questions: [{ question: 'Which scope?', options: ['Terminal output only', 'Everything'] }],
  })

  it('shows the question', () => {
    panel({ pending: [question] })
    expect(screen.getByText('Which scope?')).toBeDefined()
  })

  it('offers its options, which are most of what you need to answer', () => {
    panel({ pending: [question] })
    expect(screen.getByText('Terminal output only')).toBeDefined()
    expect(screen.getByText('Everything')).toBeDefined()
  })

  it('answers with the option’s own words, so the agent reads which was chosen', () => {
    const props = panel({ pending: [question] })
    fireEvent.click(screen.getByText('Terminal output only'))
    expect(props.onAnswer).toHaveBeenCalledWith('req-1', 'Terminal output only')
  })

  it('carries every question when more than one is asked', () => {
    panel({
      pending: [
        ask({
          questions: [
            { question: 'Which scope?', options: ['A'] },
            { question: 'Which branch?', options: ['B'] },
          ],
        }),
      ],
    })
    expect(screen.getByText('Which scope?')).toBeDefined()
    expect(screen.getByText('Which branch?')).toBeDefined()
  })
})
