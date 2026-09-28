import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { StationMonitor } from '../../../src/components/factory/StationMonitor.js'
import type { MonitorStatus } from '../../../src/components/factory/StationMonitor.js'
import type { TranscriptLine } from '../../../src/runtime/transcript-excerpt.js'

// jsdom has no canvas: the case's 2D context is a fake, and what this spec
// asserts is the screen, the chin and the keys — the case's own drawing is
// covered by tests/factory/art/monitor.spec.ts.

function fakeContext2D() {
  return {
    fillStyle: '#000',
    globalCompositeOperation: 'source-over',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  }
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

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: reduce && query.includes('reduce') }))
  )
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    fakeContext2D() as unknown as CanvasRenderingContext2D
  )
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
  it('names the monitor by its upper-cased label and says what the station is doing', () => {
    mount()
    expect(screen.getByRole('heading', { name: 'FILTER LINEAR ISSUES' })).toBeTruthy()
    expect(screen.getByText('WORKING  ATTEMPT 2  BUILDER', { normalizer: (t) => t })).toBeTruthy()
    expect(screen.getByText('FOUNDRY LINE')).toBeTruthy()
    expect(screen.getByText('WO-1')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'FILTER LINEAR ISSUES' })).toBeTruthy()
  })

  it('says the station has no agent, or needs you, before what the step says', () => {
    const exact = { normalizer: (t: string) => t }
    mount({ status: 'gone' })
    expect(screen.getByText('NO AGENT  ATTEMPT 2  BUILDER', exact)).toBeTruthy()
    cleanup()
    mount({ status: 'waiting', alert: 'WAITING FOR YOU: WANTS TO RUN BASH' })
    expect(screen.getByText('NEEDS YOU  ATTEMPT 2  BUILDER', exact)).toBeTruthy()
  })

  it('badges the chin with the floor sign, or the label when the station has none', () => {
    mount()
    expect(screen.getByText('BUILDER U-1')).toBeTruthy()
    cleanup()
    mount({ sign: null })
    expect(document.querySelector('.fdry-crt__badge')?.textContent).toBe('FILTER LINEAR ISSUES')
  })

  it('shows the cursor only while the step is running', () => {
    const shown: Record<string, boolean> = {}
    for (const status of ['running', 'waiting', 'failed', 'gone', 'idle'] as const) {
      mount({ status })
      shown[status] = document.querySelector('.fdry-crt__cursor') !== null
      cleanup()
    }
    expect(shown).toEqual({
      running: true,
      waiting: false,
      failed: false,
      gone: false,
      idle: false,
    })
  })

  it.each([
    ['running', 'Working'],
    ['waiting', 'Needs you'],
    ['failed', 'Failed'],
    ['gone', 'No agent'],
    ['idle', 'Idle'],
  ] as const)('a %s station lights its LED as "%s"', (status, led) => {
    mount({ status })
    expect(screen.getByRole('img', { name: led })).toBeTruthy()
    expect(document.querySelector('.fdry-crt')?.getAttribute('data-state')).toBe(status)
  })

  it('draws the alert line for a waiting and for a failed station, and none otherwise', () => {
    mount({ status: 'waiting', alert: 'WAITING FOR YOU: WANTS TO RUN BASH' })
    expect(screen.getByText('WAITING FOR YOU: WANTS TO RUN BASH')).toBeTruthy()
    cleanup()
    mount({ status: 'failed', alert: 'FAILED: THE CHECKS FAILED' })
    expect(screen.getByText('FAILED: THE CHECKS FAILED')).toBeTruthy()
    cleanup()
    mount({ status: 'running', alert: null })
    expect(document.querySelector('.fdry-crt__alert')).toBeNull()
  })

  it('shows an attach refusal on the screen as an alert line', () => {
    mount({ attachProblem: 'That agent is no longer in a terminal.' })
    const problem = screen.getByText('That agent is no longer in a terminal.')
    expect(problem.className).toContain('fdry-crt__alert')
    expect(problem.className).toContain('fdry-problem')
  })

  it('ends a gone station’s log with NO CARRIER', () => {
    mount({ status: 'gone' })
    const log = screen.getByRole('log', { name: 'Transcript' })
    expect(log.textContent?.trimEnd().endsWith('NO CARRIER')).toBe(true)
  })

  it('classes tool lines as tool, the agent’s words as say and yours as you', () => {
    mount()
    const log = screen.getByRole('log', { name: 'Transcript' })
    expect(log.querySelector('.tool')?.textContent).toBe('Read: src/linear.ts')
    expect(log.querySelector('.say')?.textContent).toBe('I will filter on the state type.')
    expect(log.querySelector('.you')?.textContent).toBe('go on')
    expect(log.querySelectorAll('span').length).toBe(LINES.length + 1)
  })

  it('says so when there is nothing to read yet', () => {
    mount({ lines: [], status: 'idle' })
    expect(screen.getByRole('log', { name: 'Transcript' }).textContent).toBe('NOTHING YET.')
  })

  it('attaches from its key', () => {
    const { onAttach, onClose } = mount()
    fireEvent.click(screen.getByRole('button', { name: /ATTACH/ }))
    expect(onAttach).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes at once from the power key under reduced motion', () => {
    const { onClose } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Close monitor' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.fdry-crt')?.classList.contains('is-off')).toBe(false)
  })

  it('plays the power-off before closing when motion is allowed', () => {
    setReducedMotion(false)
    vi.useFakeTimers()
    const { onClose } = mount()
    const root = document.querySelector('.fdry-crt') as HTMLElement
    expect(root.classList.contains('is-on')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Close monitor' }))
    expect(root.classList.contains('is-off')).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not power on under reduced motion', () => {
    mount()
    expect(document.querySelector('.fdry-crt')?.classList.contains('is-on')).toBe(false)
  })

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
})
