import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { KanbanLaneEditor } from '../../src/components/KanbanLaneEditor'
import type { KanbanLane } from '../../src/vault/types'

afterEach(() => cleanup())

const LANES: KanbanLane[] = [
  { id: 'todo', label: 'To do', taskStatuses: ['open'] },
  { id: 'doing', label: 'Doing', taskStatuses: ['in-progress'], dotColor: '#ff0000' },
]

function renderLaneEditor() {
  const onSave = vi.fn()
  const onClose = vi.fn()
  render(<KanbanLaneEditor lanes={LANES} onSave={onSave} onClose={onClose} />)
  const clickSave = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save lanes' }))
    return onSave.mock.calls.at(-1)?.[0] as KanbanLane[]
  }
  return { onSave, onClose, save: clickSave }
}

const nameInputs = () => screen.getAllByPlaceholderText('Lane name') as HTMLInputElement[]
const chip = (lane: number, status: string) =>
  document.querySelectorAll('.tv-lane-editor__statuses')[lane].querySelectorAll('label')[
    ['open', 'in-progress', 'in-review', 'blocked', 'done', 'migrated', 'cancelled'].indexOf(status)
  ] as HTMLLabelElement

describe('KanbanLaneEditor lanes', laneTests)
describe('KanbanLaneEditor statuses and colours', statusTests)

function laneTests() {
  describe('reordering', laneReorderingTests)
  describe('adding and cancelling', laneAddingAndCancellingTests)
}

function laneReorderingTests() {
  it('renames, reorders and removes lanes, saving the draft', () => {
    const { save } = renderLaneEditor()
    fireEvent.change(nameInputs()[0], { target: { value: 'Backlog' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0])
    expect(nameInputs().map((i) => i.value)).toEqual(['Doing', 'Backlog'])
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove lane' })[0])
    expect(save()).toEqual([{ id: 'todo', label: 'Backlog', taskStatuses: ['open'] }])
  })

  it('disables moving past either end and moves a lane up', () => {
    renderLaneEditor()
    const up = screen.getAllByRole('button', { name: 'Move up' })
    expect((up[0] as HTMLButtonElement).disabled).toBe(true)
    expect(
      (screen.getAllByRole('button', { name: 'Move down' })[1] as HTMLButtonElement).disabled
    ).toBe(true)
    fireEvent.click(up[1])
    expect(nameInputs().map((i) => i.value)).toEqual(['Doing', 'To do'])
  })
}

function laneAddingAndCancellingTests() {
  it('adds a lane with an id from its name, by button or Enter', () => {
    const { save } = renderLaneEditor()
    const add = screen.getByPlaceholderText('New lane name…')
    fireEvent.change(add, { target: { value: '  In Review! ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.change(add, { target: { value: '***' } })
    fireEvent.keyDown(add, { key: 'Enter' })
    fireEvent.keyDown(add, { key: 'Enter' })
    const lanes = save()
    expect(lanes[2]).toEqual({ id: 'in-review', label: 'In Review!', taskStatuses: [] })
    expect(lanes[3].id).toMatch(/^lane-\d+$/)
    expect(lanes).toHaveLength(4)
  })

  it('cancels without saving', () => {
    const { onClose, onSave } = renderLaneEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
  })
}

function statusTests() {
  it('maps a status to a lane, unmaps it, and blocks one used elsewhere', () => {
    const { save } = renderLaneEditor()
    expect(chip(0, 'open').className).toContain('--on')
    expect(chip(1, 'open').className).toContain('--used')
    expect(chip(1, 'open').title).toBe('Used in another lane')
    fireEvent.click(chip(0, 'open'))
    fireEvent.click(chip(0, 'done'))
    expect(save()[0].taskStatuses).toEqual(['done'])
  })

  it('sets and resets a lane dot colour', () => {
    const { save } = renderLaneEditor()
    const colours = document.querySelectorAll('input[type="color"]') as NodeListOf<HTMLInputElement>
    expect(colours[0].value).toBe('#6366f1')
    fireEvent.change(colours[0], { target: { value: '#00ff00' } })
    expect(save()[0].dotColor).toBe('#00ff00')
    fireEvent.click(screen.getAllByRole('button', { name: 'Reset' })[1])
    expect(save()[1].dotColor).toBeUndefined()
  })
}
