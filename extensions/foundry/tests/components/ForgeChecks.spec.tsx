import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { createChangeBus } from '../helpers/change-bus.js'
import { Forge } from '../../src/components/Forge.js'
import { draftOrder } from '../../src/order/draft.js'
import { compileOrder } from '../../src/order/compile.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { ProfileFacts } from '../../src/forge/checks-view.js'
import { openForgeStep } from '../helpers/forge-steps.js'
import { payloadsSentOn } from '../helpers/bridge-calls.js'
import { bareProfile, glyphProfile } from '../helpers/profile.js'

// The Checks step: every command Foundry runs in the repository, where it came from in
// words, and what running it on the base branch did. Each unknown has a move.

function orderWithUnit(unit: Partial<WorkOrder['plan']['units'][number]> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'Add tail-call elimination',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/app'],
    now: '2026-10-21T10:00:00.000Z',
  })
  const units = [
    {
      id: 'U-1',
      title: 'a',
      role: 'builder',
      lane: 1,
      dependsOn: [],
      satisfies: [],
      touches: ['src/a.ts'],
      verify: [],
      ...unit,
    },
  ] as WorkOrder['plan']['units']
  return { ...base, plan: { ...base.plan, units } }
}

// jsdom doesn't implement scrollIntoView, and openStep focuses the heading.
window.HTMLElement.prototype.scrollIntoView = vi.fn()

let invoke: ReturnType<typeof vi.fn>
const recordUsage = vi.fn()
let bus = createChangeBus()
let proveReply: unknown
let tailReply: unknown
/** What the ledger says the operator decided; the environment channel records into it. */
let decisions: { continueUnmeasured: boolean; declinePictures: boolean }
beforeEach(() => {
  recordUsage.mockClear()
  tailReply = { tail: 'checking 214 files\nall files formatted' }
  bus = createChangeBus()
  decisions = { continueUnmeasured: false, declinePictures: false }
  proveReply = { exitCode: 0, logPath: '/logs/format.log', commit: '4be1c09aaaa' }
})

const CONVERGING = new Set([
  'foundry:forge.environment',
  'foundry:order.compile',
  'foundry:order.converge',
])

function recordDecision(move: string | undefined): void {
  if (move === 'continue-unmeasured') decisions.continueUnmeasured = true
  if (move === 'decline-pictures') decisions.declinePictures = true
}

function mount(profile: ProfileFacts, order = orderWithUnit()): void {
  const answer = () => ({
    order,
    compile: compileOrder(order),
    decisions: { ...decisions },
  })
  invoke = vi.fn(async (channel: string, payload?: { move?: string }) => {
    if (channel === 'foundry:forge.environment') recordDecision(payload?.move)
    if (channel === 'foundry:log-tail') return tailReply
    if (channel === 'foundry:profile-prove') return proveReply
    if (channel === 'foundry:profile-read' || channel === 'foundry:profile-save') return profile
    return CONVERGING.has(channel) ? answer() : {}
  })
  Object.defineProperty(window, 'electronAPI', {
    value: { extensionBridge: { invoke, on: bus.on }, usage: { record: recordUsage } },
    configurable: true,
    writable: true,
  })
  render(<Forge orderId="WO-1" />)
}

const rowNamed = (name: string) => within(screen.getByRole('group', { name }))

async function openChecks(profile: ProfileFacts = glyphProfile(), order = orderWithUnit()) {
  mount(profile, order)
  await openForgeStep('Checks')
  await screen.findByRole('group', { name: 'Format' })
}

describe('the Checks step rows', () => {
  it('shows where a command came from and its proof on the base branch, in words', async () => {
    await openChecks()
    expect(rowNamed('Format').getByText("Set in the repository's own profile")).toBeTruthy()
    expect(rowNamed('Format').getByText('Exit 1 on main')).toBeTruthy()
    expect(
      rowNamed('Type check').getByText(/You set this · runs with Format and Lint/)
    ).toBeTruthy()
  })
})

describe('the Checks step moves', () => {
  it('says a missing command will report not measured, and offers to add one', async () => {
    await openChecks()
    const lint = rowNamed('Lint')
    expect(lint.getByText('No command')).toBeTruthy()
    expect(lint.getByText('Will report “not measured”')).toBeTruthy()
    expect(lint.getByRole('button', { name: 'Add a command' })).toBeTruthy()
  })

  it('offers the moves for a command that failed on main, and none for a passing one', async () => {
    await openChecks()
    expect(
      rowNamed('Format')
        .queryAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['Edit', 'Use it anyway', 'Remove'])
    expect(
      rowNamed('Tests')
        .queryAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['Edit', 'Remove'])
  })

  it('counts the failing row on the step rail', async () => {
    await openChecks()
    const rail = screen.getByRole('navigation', { name: 'Steps' })
    expect(within(rail).getByRole('button', { name: /^Checks/ }).textContent).toContain(
      '1 waiting on you'
    )
  })
})

describe('Use it anyway and Remove', () => {
  it('saves the failing command as the operator’s own', async () => {
    const user = userEvent.setup()
    await openChecks()
    await user.click(rowNamed('Format').getByRole('button', { name: 'Use it anyway' }))
    await waitFor(() =>
      expect(payloadsSentOn(invoke, 'foundry:profile-save')).toEqual([
        { repoPath: '/repos/app', checks: { format: './glyph fmt --check' } },
      ])
    )
    expect(recordUsage).toHaveBeenCalledExactlyOnceWith('profile-edit', {})
  })

  it('clears a command the operator set', async () => {
    const user = userEvent.setup()
    const profile = glyphProfile()
    profile.checks.lint = { command: 'eslint .', source: 'operator' }
    await openChecks(profile)
    await user.click(rowNamed('Lint').getByRole('button', { name: 'Remove' }))
    await waitFor(() =>
      expect(payloadsSentOn(invoke, 'foundry:profile-save')).toEqual([
        { repoPath: '/repos/app', checks: { lint: null } },
      ])
    )
  })
})

async function startEditing() {
  const user = userEvent.setup()
  await openChecks()
  await user.click(rowNamed('Format').getByRole('button', { name: 'Edit' }))
  const field = await screen.findByRole('textbox', { name: 'Command for Format' })
  await user.clear(field)
  await user.type(field, './glyph fmt --check src/')
}

describe('editing a check', () => {
  it('starts from the command as it is', async () => {
    const user = userEvent.setup()
    await openChecks()
    await user.click(rowNamed('Format').getByRole('button', { name: 'Edit' }))
    const field = await screen.findByRole('textbox', { name: 'Command for Format' })
    expect((field as HTMLInputElement).value).toBe('./glyph fmt --check')
  })
})

describe('running an edit on main', () => {
  it('runs the command on main and shows the exit code and where the log is', async () => {
    const user = userEvent.setup()
    await startEditing()
    await user.click(screen.getByRole('button', { name: 'Run on main' }))
    expect(await screen.findByText('Exit 0 on main at 4be1c09')).toBeTruthy()
    expect(screen.getByText(/\/logs\/format\.log/)).toBeTruthy()
    expect(await screen.findByText(/all files formatted/)).toBeTruthy()
    expect(payloadsSentOn(invoke, 'foundry:profile-prove')).toEqual([
      { repoPath: '/repos/app', command: './glyph fmt --check src/' },
    ])
  })

  it('keeps the command once it passes on main', async () => {
    const user = userEvent.setup()
    await startEditing()
    await user.click(screen.getByRole('button', { name: 'Run on main' }))
    expect(await screen.findByText(/Saved to this repository/)).toBeTruthy()
    expect(payloadsSentOn(invoke, 'foundry:profile-save')).toEqual([
      { repoPath: '/repos/app', checks: { format: './glyph fmt --check src/' } },
    ])
  })

  it('does not keep a command that failed on main', async () => {
    const user = userEvent.setup()
    proveReply = { exitCode: 1, logPath: '/logs/format.log', commit: '4be1c09aaaa' }
    await startEditing()
    await user.click(screen.getByRole('button', { name: 'Run on main' }))
    expect(await screen.findByText('Exit 1 on main at 4be1c09')).toBeTruthy()
    expect(payloadsSentOn(invoke, 'foundry:profile-save')).toEqual([])
  })
})

describe('a run that could not start', () => {
  it('says why when the base branch could not be checked out', async () => {
    const user = userEvent.setup()
    proveReply = { error: 'Could not check out the base branch: no such ref' }
    await startEditing()
    await user.click(screen.getByRole('button', { name: 'Run on main' }))
    expect(await screen.findByText(/Could not check out the base branch/)).toBeTruthy()
  })
})

describe('leaving an edit', () => {
  it('saves without running', async () => {
    const user = userEvent.setup()
    await startEditing()
    await user.click(screen.getByRole('button', { name: 'Save without running' }))
    await waitFor(() =>
      expect(payloadsSentOn(invoke, 'foundry:profile-save')).toEqual([
        { repoPath: '/repos/app', checks: { format: './glyph fmt --check src/' } },
      ])
    )
    expect(payloadsSentOn(invoke, 'foundry:profile-prove')).toEqual([])
  })

  it('cancels without writing anything', async () => {
    const user = userEvent.setup()
    await startEditing()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: 'Command for Format' })).toBeNull()
    expect(payloadsSentOn(invoke, 'foundry:profile-save')).toEqual([])
  })
})

describe('adding another check', () => {
  it('saves it with the group it runs with, keeping the checks already added', async () => {
    const user = userEvent.setup()
    await openChecks()
    await user.click(screen.getByRole('button', { name: 'Add another check' }))
    await user.type(screen.getByRole('textbox', { name: 'Name of the check' }), 'Docs')
    await user.type(
      screen.getByRole('textbox', { name: 'Command for the new check' }),
      './glyph docs'
    )
    await user.click(screen.getByRole('radio', { name: 'with Tests' }))
    await user.click(screen.getByRole('button', { name: 'Add check' }))
    await waitFor(() =>
      expect(payloadsSentOn(invoke, 'foundry:profile-save')).toEqual([
        {
          repoPath: '/repos/app',
          additional: [
            { name: 'Type check', command: './glyph check', rung: 'L0' },
            { name: 'Docs', command: './glyph docs', rung: 'L1' },
          ],
        },
      ])
    )
  })
})

describe('when no way to check was found', () => {
  it('replaces the list with a field and four moves', async () => {
    mount(bareProfile())
    await openForgeStep('Checks')
    expect(await screen.findByText('Foundry found no way to check this repository')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'How do you run the tests?' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Run on main' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add another check' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ask the scout to read again' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue with nothing measured' })).toBeTruthy()
  })

  it('counts as one waiting on the rail until the operator decides', async () => {
    const user = userEvent.setup()
    mount(bareProfile())
    await openForgeStep('Checks')
    const rail = screen.getByRole('navigation', { name: 'Steps' })
    const checks = () => within(rail).getByRole('button', { name: /^Checks/ })
    await waitFor(() => expect(checks().textContent).toContain('1 waiting on you'))
    await user.click(await screen.findByRole('button', { name: 'Continue with nothing measured' }))
    await waitFor(() => expect(checks().textContent).toContain('Nothing waiting on you'))
    expect(payloadsSentOn(invoke, 'foundry:forge.environment')).toEqual([
      { id: 'WO-1', move: 'continue-unmeasured' },
    ])
  })
})

describe('answering when nothing was found', () => {
  it('runs the typed command on main', async () => {
    const user = userEvent.setup()
    mount(bareProfile())
    await openForgeStep('Checks')
    await user.type(
      await screen.findByRole('textbox', { name: 'How do you run the tests?' }),
      './glyph test'
    )
    await user.click(screen.getByRole('button', { name: 'Run on main' }))
    await waitFor(() =>
      expect(payloadsSentOn(invoke, 'foundry:profile-prove')).toEqual([
        { repoPath: '/repos/app', command: './glyph test' },
      ])
    )
  })

  it('asks the architect to have the repository read again', async () => {
    const user = userEvent.setup()
    mount(bareProfile())
    await openForgeStep('Checks')
    await user.click(await screen.findByRole('button', { name: 'Ask the scout to read again' }))
    await waitFor(() => {
      const [sent] = payloadsSentOn(invoke, 'foundry:order.converge') as { message?: string }[]
      expect(sent?.message).toMatch(/how its checks are run/)
    })
  })
})

async function openHandOff(profile: ProfileFacts, order = orderWithUnit()) {
  mount(profile, order)
  await openForgeStep('Hand off')
  return screen.findByRole('group', { name: 'Checks proven on main' })
}

describe('the hand-off row for checks', () => {
  it('counts the commands proven on main and names the ones not measured', async () => {
    const user = userEvent.setup()
    const row = within(await openHandOff(glyphProfile()))
    expect(row.getByText('4 of 8')).toBeTruthy()
    expect(row.getByText(/Lint, Coverage and End-to-end have no command/)).toBeTruthy()
    await user.click(row.getByRole('button', { name: 'Open Checks' }))
    expect(await screen.findByRole('group', { name: 'Format' })).toBeTruthy()
  })
})

describe('the pictures row on hand-off', () => {
  it('leaves out the pictures row when the order changes no interface', async () => {
    await openHandOff(glyphProfile())
    expect(screen.queryByText('This order changes the interface')).toBeNull()
  })

  it('asks for a pictures command when a unit changes the interface and there is none', async () => {
    const user = userEvent.setup()
    await openHandOff(glyphProfile(), orderWithUnit({ touchesInterface: true }))
    expect(await screen.findByText('This order changes the interface')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Add a pictures command' }))
    expect(await screen.findByRole('textbox', { name: 'Command for Pictures' })).toBeTruthy()
  })

  it('stops asking once the operator ships without pictures', async () => {
    const user = userEvent.setup()
    await openHandOff(glyphProfile(), orderWithUnit({ touchesInterface: true }))
    await user.click(await screen.findByRole('button', { name: 'Ship without pictures' }))
    await waitFor(() => expect(screen.queryByText('This order changes the interface')).toBeNull())
    expect(payloadsSentOn(invoke, 'foundry:forge.environment')).toEqual([
      { id: 'WO-1', move: 'decline-pictures' },
    ])
  })
})

describe('the pictures row once it is settled', () => {
  it('is not asked again once the ledger says the operator declined', async () => {
    decisions.declinePictures = true
    await openHandOff(glyphProfile(), orderWithUnit({ touchesInterface: true }))
    expect(screen.queryByText('This order changes the interface')).toBeNull()
  })

  it('is not asked when the profile has a pictures command', async () => {
    const profile = glyphProfile({ pictures: { command: './glyph shots', source: 'operator' } })
    await openHandOff(profile, orderWithUnit({ touchesInterface: true }))
    expect(screen.queryByText('This order changes the interface')).toBeNull()
  })
})

describe('removing a command Foundry found', () => {
  it('says no command is wanted, from the Remove move on a command from another source', async () => {
    const user = userEvent.setup()
    await openChecks()
    await user.click(rowNamed('Format').getByRole('button', { name: 'Remove' }))
    await waitFor(() =>
      expect(payloadsSentOn(invoke, 'foundry:profile-save')).toEqual([
        { repoPath: '/repos/app', remove: ['format'] },
      ])
    )
  })

  it('shows the removed state with a move to restore it', async () => {
    const user = userEvent.setup()
    const profile = glyphProfile({ removed: ['format'] })
    profile.checks.format = null
    await openChecks(profile)
    const format = rowNamed('Format')
    expect(format.getByText('No command')).toBeTruthy()
    expect(format.getByText('You removed the one Foundry found')).toBeTruthy()
    await user.click(format.getByRole('button', { name: 'Restore' }))
    await waitFor(() =>
      expect(payloadsSentOn(invoke, 'foundry:profile-save')).toEqual([
        { repoPath: '/repos/app', checks: { format: null } },
      ])
    )
  })
})
