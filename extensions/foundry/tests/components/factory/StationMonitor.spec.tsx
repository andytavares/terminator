import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StationMonitor } from '../../../src/components/factory/StationMonitor.js'
import type { MonitorStatus } from '../../../src/components/factory/StationMonitor.js'
import type { TranscriptLine } from '../../../src/runtime/transcript-excerpt.js'
import { partialFake } from '../../../../../packages/test-support/src/fakes'

// jsdom has no canvas: the case's 2D context is a fake, and what this spec
// asserts is the screen, the chin and the keys — the case's own drawing is
// covered by tests/factory/art/monitor.spec.ts.

function fakeContext2D() {
  return partialFake<CanvasRenderingContext2D>({
    fillStyle: '#000',
    globalCompositeOperation: 'source-over',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  })
}

const LINES: TranscriptLine[] = [
  { role: 'assistant', kind: 'text', text: 'I will filter on the state type.', at: 1 },
  { role: 'assistant', kind: 'tool', text: 'Read: src/linear.ts', at: 2 },
  { role: 'user', kind: 'text', text: 'go on', at: 3 },
]

function mount(
  over: Partial<React.ComponentProps<typeof StationMonitor>> & { status?: MonitorStatus } = {}
) {
  const onAttach = vi.fn()
  const onClose = vi.fn()
  render(
    <StationMonitor
      node={{ id: 'N-1', state: 'running', attempts: 2, role: 'builder' }}
      label="Filter Linear issues"
      sign="BUILDER U-1"
      orderId="WO-1"
      lines={LINES}
      status="running"
      alert={null}
      attachProblem={null}
      onAttach={onAttach}
      onClose={onClose}
      {...over}
    />
  )
  return { onAttach, onClose }
}

function monitor(): HTMLElement {
  return screen.getByRole('region', { name: 'FILTER LINEAR ISSUES' })
}

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: reduce && query.includes('reduce') }))
  )
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext2D())
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
    }
  )
  setReducedMotion(true)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('StationMonitor', () => {
  describe('naming', namingTests)
  describe('the cursor', theCursorTests)
  describe('LED and alerts', ledAndAlertsTests)
  describe('refusals and NO CARRIER', refusalsAndNoCarrierTests)
  describe('lines', linesTests)
  describe('keys', keysTests)
  describe('powering off and on', poweringOffAndOnTests)
  describe('following', followingTests)
})

const gate = { id: 'ship', state: 'running' as const, attempts: 0, role: null }

function namingTests() {
  it('names the monitor by its upper-cased label and says what the station is doing', () => {
    mount()
    expect(screen.getByRole('heading', { name: 'FILTER LINEAR ISSUES' })).toBeTruthy()
    expect(screen.getByText('WORKING  ATTEMPT 2  BUILDER', { normalizer: (t) => t })).toBeTruthy()
    expect(screen.getByText('FOUNDRY LINE')).toBeTruthy()
    expect(screen.getByText('WO-1')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'FILTER LINEAR ISSUES' })).toBeTruthy()
  })

  it.each([
    ['gone', null, 'NO AGENT  ATTEMPT 2  BUILDER'],
    ['waiting', 'WAITING FOR YOU: WANTS TO RUN BASH', 'NEEDS YOU  ATTEMPT 2  BUILDER'],
  ] as const)('a %s station says so before what the step says', (status, alert, line) => {
    mount({ status, alert })
    expect(screen.getByText(line, { normalizer: (t: string) => t }).textContent).toBe(line)
  })

  it('badges the chin with the floor sign', () => {
    mount()
    expect(screen.getByText('BUILDER U-1', { selector: '.fdry-crt__badge' })).toBeTruthy()
  })

  it('badges the chin with the label when the station has no floor sign', () => {
    mount({ sign: null })
    expect(screen.getByText('FILTER LINEAR ISSUES', { selector: '.fdry-crt__badge' })).toBeTruthy()
  })
}

function theCursorTests() {
  it.each([
    ['running', true],
    ['waiting', false],
    ['failed', false],
    ['gone', false],
    ['idle', false],
  ] as const)('a %s station shows the cursor: %s', (status, shown) => {
    mount({ status })
    expect(screen.queryByTestId('crt-cursor') !== null).toBe(shown)
  })
}

function ledAndAlertsTests() {
  it.each([
    ['running', 'Working'],
    ['waiting', 'Needs you'],
    ['failed', 'Failed'],
    ['gone', 'No agent'],
    ['idle', 'Idle'],
  ] as const)('a %s station lights its LED as "%s"', (status, led) => {
    mount({ status })
    expect(screen.getByRole('img', { name: led })).toBeTruthy()
    expect(monitor().getAttribute('data-state')).toBe(status)
  })

  it.each([
    ['waiting', 'WAITING FOR YOU: WANTS TO RUN BASH'],
    ['failed', 'FAILED: THE CHECKS FAILED'],
  ] as const)('a %s station draws its alert line', (status, alert) => {
    mount({ status, alert })
    expect(screen.getByRole('alert').textContent).toBe(alert)
  })

  it('a running station draws no alert line', () => {
    mount({ status: 'running', alert: null })
    expect(screen.queryByRole('alert')).toBeNull()
  })
}

function refusalsAndNoCarrierTests() {
  it('shows an attach refusal on the screen as an alert line', () => {
    mount({ attachProblem: 'That agent is no longer in an agent tab.' })
    const problem = screen.getByText('That agent is no longer in an agent tab.')
    expect(problem.className).toContain('fdry-crt__alert')
    expect(problem.className).toContain('fdry-problem')
  })

  it('ends a gone station’s log with NO CARRIER', () => {
    mount({ status: 'gone' })
    const log = screen.getByRole('log', { name: 'Transcript' })
    expect(log.textContent?.trimEnd().endsWith('NO CARRIER')).toBe(true)
  })
}

function linesTests() {
  it('classes tool lines as tool, the agent’s words as say and yours as you', () => {
    mount()
    const log = screen.getByRole('log', { name: 'Transcript' })
    expect(within(log).getByText('Read: src/linear.ts').className).toBe('tool')
    expect(within(log).getByText('I will filter on the state type.').className).toBe('say')
    expect(within(log).getByText('go on').className).toBe('you')
  })

  it('says so when there is nothing to read yet', () => {
    mount({ lines: [], status: 'idle' })
    expect(screen.getByRole('log', { name: 'Transcript' }).textContent).toBe('NOTHING YET.')
  })
}

function keysTests() {
  it('attaches from its key', async () => {
    const user = userEvent.setup()
    const { onAttach, onClose } = mount()
    await user.click(screen.getByRole('button', { name: /ATTACH/ }))
    expect(onAttach).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes at once from the power key under reduced motion', async () => {
    const user = userEvent.setup()
    const { onClose } = mount()
    await user.click(screen.getByRole('button', { name: 'Close monitor' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(monitor().classList.contains('is-off')).toBe(false)
  })
}

function poweringOffAndOnTests() {
  it('plays the power-off before closing when motion is allowed', async () => {
    setReducedMotion(false)
    // shouldAdvanceTime: Testing Library's async wrapper waits on a timer, or user-event hangs.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { onClose } = mount()
    const root = monitor()
    expect(root.classList.contains('is-on')).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Close monitor' }))
    expect(root.classList.contains('is-off')).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not power on under reduced motion', () => {
    mount()
    expect(monitor().classList.contains('is-on')).toBe(false)
  })
}

function followingTests() {
  it('follows a new line unless the reader has scrolled up', () => {
    const props = {
      node: { id: 'N-1', state: 'running' as const, attempts: 1, role: null },
      label: 'Build',
      sign: null,
      orderId: 'WO-1',
      status: 'running' as const,
      alert: null,
      attachProblem: null,
      onAttach: vi.fn(),
      onClose: vi.fn(),
    }
    const { rerender } = render(<StationMonitor {...props} lines={LINES} />)
    const log = screen.getByRole('log', { name: 'Transcript' })
    let height = 500
    Object.defineProperty(log, 'scrollHeight', { get: () => height, configurable: true })
    Object.defineProperty(log, 'clientHeight', { value: 100, configurable: true })

    log.scrollTop = 400
    fireEvent.scroll(log)
    height = 600
    rerender(<StationMonitor {...props} lines={[...LINES, { ...LINES[0]!, at: 9 }]} />)
    expect(log.scrollTop).toBe(600)

    log.scrollTop = 100
    fireEvent.scroll(log)
    height = 700
    rerender(<StationMonitor {...props} lines={[...LINES, LINES[0]!, { ...LINES[0]!, at: 10 }]} />)
    expect(log.scrollTop).toBe(100)
  })
}

describe('StationMonitor on a step with no agent', () => {
  describe('what it decided', whatItDecidedTests)
  describe('no attach and nothing decided', noAttachAndNothingDecidedTests)
})

function whatItDecidedTests() {
  const exact = { normalizer: (t: string) => t }

  it('says the step is automatic and shows what it decided, with no attempt count', () => {
    mount({
      node: gate,
      label: 'Ship',
      lines: [],
      status: 'running',
      facts: ['Draft opened · #233', 'Checks · 12 of 19 passed', 'Waiting on you · mark ready?'],
    })
    expect(screen.getByText('Automatic step · no agent')).toBeTruthy()
    const decided = screen.getByRole('log', { name: 'What this step decided' })
    expect(decided.textContent).toBe(
      'Draft opened · #233\nChecks · 12 of 19 passed\nWaiting on you · mark ready?'
    )
    expect(document.body.textContent).not.toMatch(/attempt/i)
    expect(document.body.textContent).not.toContain('NOTHING YET')
    expect(screen.getByText('WORKING', exact)).toBeTruthy()
  })
}

function noAttachAndNothingDecidedTests() {
  it('offers no attach key, and no cursor, for a step with no agent', () => {
    mount({ node: gate, facts: ['Joined Inspector and Scribe'], lines: [] })
    expect(screen.queryByRole('button', { name: /ATTACH/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Agent closed/ })).toBeNull()
    expect(screen.queryByTestId('crt-cursor')).toBeNull()
  })

  it('says so when a step with no agent has decided nothing yet', () => {
    mount({ node: gate, facts: [], lines: [], status: 'idle' })
    expect(screen.getByRole('log', { name: 'What this step decided' }).textContent).toBe(
      'Nothing decided yet.'
    )
  })
}

describe('StationMonitor on a finished agent', () => {
  it('keeps the transcript and disables attach, naming the reason on the key', async () => {
    const user = userEvent.setup()
    const { onAttach } = mount({ attachable: false, status: 'idle' })
    expect(screen.getByRole('log', { name: 'Transcript' }).textContent).toContain('go on')
    const key = screen.getByRole('button', { name: /Agent closed/i }) as HTMLButtonElement
    expect(key.disabled).toBe(true)
    await user.click(key)
    expect(onAttach).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /^ATTACH$/ })).toBeNull()
  })
})
