import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  StallControls,
  StallActions,
} from '../../../../src/renderer/components/supervision/StallControls.js'
import {
  AutonomyPicker,
  BackpressureDialog,
  ProvisioningStatus,
} from '../../../../src/renderer/components/supervision/AssignControls.js'
import type { RecordedFiring } from '../../../../src/main/supervision/stall/firing-log.js'

const firing = (over: Partial<RecordedFiring> = {}): RecordedFiring => ({
  id: 'f1',
  sessionId: 's1',
  signal: 'silence',
  firedAt: 9 * 60_000,
  inputs: {
    toolSilenceMs: 9 * 60_000,
    diffSilenceMs: 0,
    distinctFiles: 0,
    netChange: 0,
    reverts: 0,
    shellInFlight: false,
  },
  shadowMode: true,
  judgement: null,
  judgedAt: null,
  ...over,
})

const noPrecision = { total: 1, judged: 0, incorrect: 0, incorrectRate: null }

describe('StallControls — turning shadow mode off (FR-018, FR-019)', () => {
  it('says shadow mode is recording rather than surfacing', () => {
    render(
      <StallControls
        shadowMode
        firings={[firing()]}
        precision={noPrecision}
        onSetShadowMode={() => {}}
        onJudge={() => {}}
      />
    )
    expect(screen.getByText(/recording, not surfacing/)).toBeDefined()
  })

  it('offers the toggle that lets stalls surface at all', () => {
    const onSetShadowMode = vi.fn()
    render(
      <StallControls
        shadowMode
        firings={[]}
        precision={noPrecision}
        onSetShadowMode={onSetShadowMode}
        onJudge={() => {}}
      />
    )
    fireEvent.click(screen.getByText('Turn shadow mode off'))
    expect(onSetShadowMode).toHaveBeenCalledWith(false)
  })

  it('says stalls are surfaced once shadow mode is off', () => {
    render(
      <StallControls
        shadowMode={false}
        firings={[]}
        precision={noPrecision}
        onSetShadowMode={() => {}}
        onJudge={() => {}}
      />
    )
    expect(screen.getByText('Stalls are surfaced')).toBeDefined()
  })

  it('reports nothing judged rather than implying the detector is perfect', () => {
    render(
      <StallControls
        shadowMode
        firings={[firing()]}
        precision={noPrecision}
        onSetShadowMode={() => {}}
        onJudge={() => {}}
      />
    )
    expect(screen.getByText(/none judged yet/)).toBeDefined()
  })

  it('reports the incorrect rate once firings have been judged (FR-020)', () => {
    render(
      <StallControls
        shadowMode
        firings={[firing({ judgement: 'incorrect' })]}
        precision={{ total: 20, judged: 20, incorrect: 1, incorrectRate: 0.05 }}
        onSetShadowMode={() => {}}
        onJudge={() => {}}
      />
    )
    expect(screen.getByText(/5% judged incorrect/)).toBeDefined()
    expect(screen.getByText(/good enough to leave shadow mode/)).toBeDefined()
  })

  it('does not encourage leaving shadow mode on a thin sample', () => {
    render(
      <StallControls
        shadowMode
        firings={[firing()]}
        precision={{ total: 2, judged: 2, incorrect: 0, incorrectRate: 0 }}
        onSetShadowMode={() => {}}
        onJudge={() => {}}
      />
    )
    expect(screen.getByText(/Judge some firings before deciding/)).toBeDefined()
  })

  it('records a judgement against a firing', () => {
    const onJudge = vi.fn()
    render(
      <StallControls
        shadowMode
        firings={[firing()]}
        precision={noPrecision}
        onSetShadowMode={() => {}}
        onJudge={onJudge}
      />
    )
    fireEvent.click(screen.getByText('Wrong'))
    expect(onJudge).toHaveBeenCalledWith('f1', 'incorrect')
  })

  it('shows the inputs that triggered a firing, so it can be re-judged', () => {
    render(
      <StallControls
        shadowMode
        firings={[firing()]}
        precision={noPrecision}
        onSetShadowMode={() => {}}
        onJudge={() => {}}
      />
    )
    expect(screen.getByText(/silence 9m/)).toBeDefined()
  })

  it('says so when nothing has fired', () => {
    render(
      <StallControls
        shadowMode
        firings={[]}
        precision={{ total: 0, judged: 0, incorrect: 0, incorrectRate: null }}
        onSetShadowMode={() => {}}
        onJudge={() => {}}
      />
    )
    expect(screen.getByText('No stalls have fired.')).toBeDefined()
  })
})

describe('StallActions (FR-021)', () => {
  it('offers all four actions the spec requires', () => {
    const handlers = {
      onAsk: vi.fn(),
      onShowTranscript: vi.fn(),
      onInterrupt: vi.fn(),
      onDiscard: vi.fn(),
    }
    render(<StallActions sessionId="s1" {...handlers} />)
    fireEvent.click(screen.getByText(/Ask what is wrong/))
    fireEvent.click(screen.getByText(/Show activity/))
    fireEvent.click(screen.getByText(/Interrupt and redirect/))
    fireEvent.click(screen.getByText(/Discard session and worktree/))
    for (const handler of Object.values(handlers)) {
      expect(handler).toHaveBeenCalledWith('s1')
    }
  })
})

describe('AutonomyPicker (FR-041, FR-042)', () => {
  it('offers the four levels in order', () => {
    render(<AutonomyPicker value="edit" onChange={() => {}} />)
    for (const level of ['read', 'edit', 'build', 'ship']) {
      expect(screen.getByText(level)).toBeDefined()
    }
  })

  it('marks the chosen level', () => {
    render(<AutonomyPicker value="build" onChange={() => {}} />)
    const chosen = screen.getByDisplayValue('build') as HTMLInputElement
    expect(chosen.checked).toBe(true)
  })

  it('reports a change', () => {
    const onChange = vi.fn()
    render(<AutonomyPicker value="read" onChange={onChange} />)
    fireEvent.click(screen.getByDisplayValue('ship'))
    expect(onChange).toHaveBeenCalledWith('ship')
  })

  it('states that an off-allowlist host asks at every level', () => {
    render(<AutonomyPicker value="ship" onChange={() => {}} />)
    expect(screen.getByText(/asks at every\s+level/)).toBeDefined()
  })
})

describe('BackpressureDialog (FR-053, FR-054)', () => {
  const refused = {
    allowed: false,
    unreviewed: 3,
    limit: 3,
    reason:
      '3 finished sessions are waiting for review, and the limit is 3. Review something, or override.',
  }

  it('states the reason and the count rather than greying a button out', () => {
    render(
      <BackpressureDialog
        decision={refused}
        onOverride={() => {}}
        onCancel={() => {}}
        onReviewNow={() => {}}
      />
    )
    expect(screen.getByText(/waiting for review, and the limit is 3/)).toBeDefined()
  })

  it('offers the override in one action', () => {
    const onOverride = vi.fn()
    render(
      <BackpressureDialog
        decision={refused}
        onOverride={onOverride}
        onCancel={() => {}}
        onReviewNow={() => {}}
      />
    )
    fireEvent.click(screen.getByText(/Start anyway/))
    expect(onOverride).toHaveBeenCalled()
  })

  it('offers reviewing instead, which is the point of the gate', () => {
    const onReviewNow = vi.fn()
    render(
      <BackpressureDialog
        decision={refused}
        onOverride={() => {}}
        onCancel={() => {}}
        onReviewNow={onReviewNow}
      />
    )
    fireEvent.click(screen.getByText('Review something'))
    expect(onReviewNow).toHaveBeenCalled()
  })

  it('renders nothing when the start is allowed', () => {
    const { container } = render(
      <BackpressureDialog
        decision={{ allowed: true, unreviewed: 1, limit: 3, reason: null }}
        onOverride={() => {}}
        onCancel={() => {}}
        onReviewNow={() => {}}
      />
    )
    expect(container.firstChild).toBeNull()
  })
})

describe('ProvisioningStatus (FR-033, FR-034, FR-044)', () => {
  it('shows the worktree path and its allocated ports', () => {
    render(
      <ProvisioningStatus
        worktreePath="/wt/FLU-220-fluent"
        ports={{ portBase: 4000, portSpan: 10 }}
        setup={null}
        skipped={[]}
        onOpenInEditor={() => {}}
      />
    )
    expect(screen.getByText('/wt/FLU-220-fluent')).toBeDefined()
    expect(screen.getByText(/ports 4000–4009/)).toBeDefined()
  })

  it('shows the setup output on failure, so no transcript is needed', () => {
    render(
      <ProvisioningStatus
        worktreePath="/wt/x"
        ports={null}
        setup={{ exitCode: 3, output: 'pnpm install failed', durationMs: 10 }}
        skipped={[]}
        onOpenInEditor={() => {}}
      />
    )
    expect(screen.getByText('Provisioning failed')).toBeDefined()
    expect(screen.getByText('pnpm install failed')).toBeDefined()
    expect(screen.getByText(/No agent was started/)).toBeDefined()
  })

  it('reports a skipped share rather than staying silent about it', () => {
    render(
      <ProvisioningStatus
        worktreePath="/wt/x"
        ports={null}
        setup={null}
        skipped={[{ path: 'node_modules', reason: 'not present in the primary checkout' }]}
        onOpenInEditor={() => {}}
      />
    )
    expect(screen.getByText(/skipped node_modules/)).toBeDefined()
  })

  it('offers the editor handoff (FR-044)', () => {
    const onOpenInEditor = vi.fn()
    render(
      <ProvisioningStatus
        worktreePath="/wt/x"
        ports={null}
        setup={null}
        skipped={[]}
        onOpenInEditor={onOpenInEditor}
      />
    )
    fireEvent.click(screen.getByText('Open in editor'))
    expect(onOpenInEditor).toHaveBeenCalled()
  })
})
