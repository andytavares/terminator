import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { Orders } from '../../src/components/Orders.js'
import { payloadsSentOn } from '../helpers/bridge-calls.js'

// The two ends of an order's life on this surface: starting one from a ticket
// picked from your own, and getting rid of one that is open. Each goes through
// a channel and comes back to the list, or says why it did not.

type Answer = (payload: Record<string, unknown>) => unknown
let invoke = vi.fn()

// Renders the surface over channels answered by `answers`. A channel left out never
// answers, which keeps the Forge and the Floor at their loading lines.
function mount(answers: Record<string, Answer>, props: Record<string, unknown> = {}): void {
  invoke = vi.fn(async (channel: string, payload: Record<string, unknown> = {}) => {
    const answer = answers[channel]
    return answer === undefined ? new Promise(() => {}) : answer(payload)
  })
  Object.defineProperty(window, 'electronAPI', {
    value: { extensionBridge: { invoke, on: vi.fn(() => vi.fn()) }, usage: { record: vi.fn() } },
    configurable: true,
    writable: true,
  })
  render(<Orders repoRoot="/repos/app" {...props} />)
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'WO-1',
    title: 'Refuse an expired refresh token',
    status: 'draft',
    risk: 'P2',
    failures: 0,
    source: { kind: 'typed', tracker: null, key: null },
    ...over,
  }
}

const mine = {
  connected: [{ tracker: 'linear', account: 'me' }],
  issues: [
    { tracker: 'linear', key: 'TAV-14', title: 'Make all text red', status: 'Todo' },
    { tracker: 'linear', key: 'TAV-16', title: 'Group the Ledger', status: '' },
  ],
}

beforeEach(() => vi.clearAllMocks())

describe('starting an order from a ticket', () => {
  describe('picking one', pickingTests)
  describe('searching', searchingTests)
  describe('nothing to pick', nothingToPickTests)
})

async function pickTicket(answers: Record<string, Answer>): Promise<void> {
  mount({
    'foundry:order.list': () => ({ orders: [] }),
    'foundry:issues.mine': () => mine,
    ...answers,
  })
  fireEvent.click(screen.getByRole('radio', { name: 'Ticket' }))
  fireEvent.click(await screen.findByRole('button', { name: /TAV-14/ }))
}

function pickingTests() {
  it('makes a tracker order from the ticket and opens it', async () => {
    await pickTicket({ 'foundry:order.create': () => ({ order: row({ id: 'WO-7' }) }) })
    await screen.findByRole('button', { name: 'All orders' })
    expect(payloadsSentOn(invoke, 'foundry:order.create')).toEqual([
      { source: { kind: 'tracker', tracker: 'linear', key: 'TAV-14' }, repoPaths: ['/repos/app'] },
    ])
  })

  it('opens the order already made from that ticket rather than failing', async () => {
    await pickTicket({ 'foundry:order.create': () => ({ existing: { id: 'WO-3' } }) })
    await screen.findByRole('button', { name: 'All orders' })
  })

  it('says why and stays on the list when the order cannot be made', async () => {
    await pickTicket({ 'foundry:order.create': () => ({ error: 'That ticket is closed.' }) })
    await screen.findByText('That ticket is closed.')
    expect(screen.queryByRole('button', { name: 'All orders' })).toBeNull()
  })

  it('shows a ticket status only when it has one', async () => {
    await pickTicket({ 'foundry:order.create': () => ({ error: 'no' }) })
    await screen.findByText('no')
    expect(screen.getByText('Todo')).toBeTruthy()
    expect(document.querySelectorAll('.fdry-ticket-status')).toHaveLength(1)
  })
}

function searchingTests() {
  it('searches on Enter and on Find, not on every keystroke', async () => {
    mount({ 'foundry:order.list': () => ({ orders: [] }), 'foundry:issues.mine': () => mine })
    fireEvent.click(screen.getByRole('radio', { name: 'Ticket' }))
    await screen.findByRole('button', { name: /TAV-14/ })
    const search = screen.getByLabelText('Search your tickets')
    fireEvent.change(search, { target: { value: 'ledger' } })
    expect(payloadsSentOn(invoke, 'foundry:issues.mine')).toEqual([{ term: '' }])
    fireEvent.keyDown(search, { key: 'a' })
    fireEvent.keyDown(search, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Find' }))
    await waitFor(() => expect(payloadsSentOn(invoke, 'foundry:issues.mine')).toHaveLength(3))
    expect(payloadsSentOn(invoke, 'foundry:issues.mine').slice(1)).toEqual([
      { term: 'ledger' },
      { term: 'ledger' },
    ])
  })
}

function nothingToPickTests() {
  it('says what went wrong reading the tickets', async () => {
    mount({
      'foundry:order.list': () => ({ orders: [] }),
      'foundry:issues.mine': () => ({ error: 'Linear is unreachable' }),
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Ticket' }))
    await screen.findByText('Linear is unreachable')
  })

  it('says when no ticket matched', async () => {
    mount({
      'foundry:order.list': () => ({ orders: [] }),
      'foundry:issues.mine': () => ({ connected: mine.connected, issues: [] }),
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Ticket' }))
    await screen.findByText('No tickets matched. Try a different search.')
  })

  it('says how to connect a tracker when none is', async () => {
    mount({
      'foundry:order.list': () => ({ orders: [] }),
      'foundry:issues.mine': () => ({ connected: [], issues: [] }),
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Ticket' }))
    await screen.findByText(/No tracker is connected/)
  })
}

describe('an open order', () => {
  describe('the way back', theWayBackTests)
  describe('discarding', discardingTests)
  describe('deleting', ordersSeedAndEndDeletingTests)
})

function openOn(status: string, answers: Record<string, Answer> = {}): void {
  mount(
    { 'foundry:order.list': () => ({ orders: [row({ status })] }), ...answers },
    { openOrderId: 'WO-1' }
  )
}

/** Goes back to the list, where whatever the open order's controls ran into is said. */
async function backToTheList(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'All orders' }))
  await screen.findByRole('heading', { name: /Orders/ })
}

function theWayBackTests() {
  it('goes back to the list and reads it again', async () => {
    openOn('draft')
    fireEvent.click(await screen.findByRole('button', { name: 'All orders' }))
    await screen.findByRole('heading', { name: /Orders/ })
    expect(payloadsSentOn(invoke, 'foundry:order.list').length).toBeGreaterThan(1)
  })
}

function discardingTests() {
  it('marks a draft cancelled and goes back to the list', async () => {
    openOn('draft', { 'foundry:order.cancel': () => ({}) })
    fireEvent.click(await screen.findByRole('button', { name: 'Discard this order' }))
    await screen.findByRole('heading', { name: /Orders/ })
    expect(payloadsSentOn(invoke, 'foundry:order.cancel')).toEqual([{ id: 'WO-1' }])
  })

  it('stays open when the discard is refused, and the list says why', async () => {
    openOn('draft', { 'foundry:order.cancel': () => ({ error: 'It is running.' }) })
    fireEvent.click(await screen.findByRole('button', { name: 'Discard this order' }))
    await waitFor(() => expect(payloadsSentOn(invoke, 'foundry:order.cancel')).toHaveLength(1))
    await backToTheList()
    await screen.findByText('It is running.')
  })

  it('offers no discard for a running order', async () => {
    openOn('running')
    await screen.findByRole('button', { name: 'All orders' })
    await screen.findByText('Loading the run…')
    expect(screen.queryByRole('button', { name: 'Discard this order' })).toBeNull()
  })
}

async function confirmDelete(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: 'Delete this order' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Delete it and everything it made' }))
}

function ordersSeedAndEndDeletingTests() {
  it('deletes the order, whatever its status, and goes back to the list', async () => {
    openOn('running', { 'foundry:order.delete': () => ({}) })
    await confirmDelete()
    await screen.findByRole('heading', { name: /Orders/ })
    expect(payloadsSentOn(invoke, 'foundry:order.delete')).toEqual([{ id: 'WO-1' }])
  })

  it('stays open after a partial teardown, and the list says what it left behind', async () => {
    openOn('draft', {
      'foundry:order.delete': () => ({ failed: ['branch foundry/WO-1', 'worktree lane-1'] }),
    })
    await confirmDelete()
    await waitFor(() => expect(payloadsSentOn(invoke, 'foundry:order.delete')).toHaveLength(1))
    await backToTheList()
    await screen.findByText('branch foundry/WO-1; worktree lane-1')
  })

  it('says the refusal rather than what was left, when the delete is refused', async () => {
    openOn('draft', { 'foundry:order.delete': () => ({ error: 'No such order.', failed: ['x'] }) })
    await confirmDelete()
    await waitFor(() => expect(payloadsSentOn(invoke, 'foundry:order.delete')).toHaveLength(1))
    await backToTheList()
    await screen.findByText('No such order.')
  })
}
