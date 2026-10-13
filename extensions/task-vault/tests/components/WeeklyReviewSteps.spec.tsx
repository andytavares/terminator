import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { installBridge, eventually, project, task } from './helpers/bridge'
import { WeeklyReviewStep1GetClear } from '../../src/components/WeeklyReviewStep1GetClear'
import { WeeklyReviewStep3Projects } from '../../src/components/WeeklyReviewStep3Projects'
import { WeeklyReviewStep5Someday } from '../../src/components/WeeklyReviewStep5Someday'
import { WeeklyReviewStep6Reflect } from '../../src/components/WeeklyReviewStep6Reflect'

let bridge: ReturnType<typeof installBridge>

beforeEach(() => {
  bridge = installBridge()
})

afterEach(() => cleanup())

describe('Step 1: get clear', step1Tests)
describe('Step 3: projects', step3Tests)
describe('Step 5: someday', step5Tests)
describe('Step 6: reflect', step6Tests)

function step1Tests() {
  describe('capturing', step1CapturingTests)
  describe('failures and skipping', step1FailuresAndSkippingTests)
}

function step1CapturingTests() {
  it('captures a loose item to the inbox, lists it and logs it', async () => {
    render(<WeeklyReviewStep1GetClear onComplete={vi.fn()} reviewId="r1" />)
    const input = screen.getByPlaceholderText('Add to inbox…')
    fireEvent.change(input, { target: { value: '  call the bank ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await screen.findByText('call the bank')
    expect(bridge.calls('task-vault:vault:add-task')).toEqual([
      { filePath: 'inbox.md', text: 'call the bank' },
    ])
    expect(bridge.calls('task-vault:review:log')[0]).toMatchObject({
      reviewId: 'r1',
      step: 1,
      action: 'captured',
      entityLabel: 'call the bank',
    })
    expect((input as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('button', { name: 'Nothing loose — skip' })).toBeNull()
  })
}

function step1FailuresAndSkippingTests() {
  it('keeps the text and logs nothing when the capture fails', async () => {
    bridge.responses['task-vault:vault:add-task'] = { error: 'boom' }
    render(<WeeklyReviewStep1GetClear onComplete={vi.fn()} reviewId="r1" />)
    const input = screen.getByPlaceholderText('Add to inbox…')
    fireEvent.change(input, { target: { value: 'receipt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await eventually(() => expect(bridge.calls('task-vault:vault:add-task')).toHaveLength(1))
    await eventually(() => expect((input as HTMLInputElement).disabled).toBe(false))
    expect((input as HTMLInputElement).value).toBe('receipt')
    expect(bridge.calls('task-vault:review:log')).toEqual([])
  })

  it('ignores blank input and lets the step be skipped or finished', () => {
    const onComplete = vi.fn()
    render(<WeeklyReviewStep1GetClear onComplete={onComplete} reviewId={null} />)
    fireEvent.keyDown(screen.getByPlaceholderText('Add to inbox…'), { key: 'Enter' })
    expect(bridge.calls('task-vault:vault:add-task')).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Nothing loose — skip' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next: inbox' }))
    expect(onComplete).toHaveBeenCalledTimes(2)
  })
}

const fresh = project('Launch')
const stale = project('Garden', { isStale: true, nextActionCount: 0 })

function step3Tests() {
  describe('actions', step3ActionsTests)
  describe('updating', step3UpdatingTests)
}

function step3ActionsTests() {
  it('offers someday or archive for a stale project, and keep for a live one', () => {
    render(
      <WeeklyReviewStep3Projects
        activeProjects={[fresh, stale]}
        onComplete={vi.fn()}
        reviewId="r1"
      />
    )
    expect(screen.getByText('stale')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Someday' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: /Keep/ })).toHaveLength(1)
  })
}

function step3UpdatingTests() {
  it('updates a project status, logs it and removes it from the list', async () => {
    render(
      <WeeklyReviewStep3Projects activeProjects={[stale]} onComplete={vi.fn()} reviewId="r1" />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    await screen.findByText('All projects reviewed!')
    expect(bridge.calls('task-vault:vault:update-project-status')).toEqual([
      { projectFilePath: 'Garden', status: 'archived' },
    ])
    expect(bridge.calls('task-vault:review:log')[0]).toMatchObject({
      step: 3,
      action: 'project-status',
      detail: 'archived',
    })
  })

  it('advances to the next step', () => {
    const onComplete = vi.fn()
    render(
      <WeeklyReviewStep3Projects activeProjects={[]} onComplete={onComplete} reviewId={null} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Next: stale' }))
    expect(onComplete).toHaveBeenCalled()
  })
}

function renderStep5() {
  render(
    <WeeklyReviewStep5Someday
      somedayProjects={[project('Boat', { status: 'someday' })]}
      somedayTasks={[task('t1', 'learn knots'), task('t2', 'paint fence')]}
      onComplete={vi.fn()}
      reviewId="r1"
    />
  )
}

function step5Tests() {
  describe('empty and tasks', step5EmptyAndTasksTests)
  describe('projects', step5ProjectsTests)
}

function step5EmptyAndTasksTests() {
  it('says the backlog is empty when there is nothing in it', () => {
    render(
      <WeeklyReviewStep5Someday
        somedayProjects={[]}
        somedayTasks={[]}
        onComplete={vi.fn()}
        reviewId={null}
      />
    )
    expect(screen.getByText('Nothing in the backlog.')).toBeTruthy()
    expect(screen.queryByText('Backlog Tasks')).toBeNull()
  })

  it('picks a task up for today and archives another', async () => {
    renderStep5()
    fireEvent.click(screen.getAllByRole('button', { name: 'Pick up today' })[0])
    await eventually(() => expect(screen.queryByText('learn knots')).toBeNull())
    fireEvent.click(screen.getAllByRole('button', { name: 'Archive' })[0])
    await eventually(() => expect(screen.queryByText('paint fence')).toBeNull())
    expect(bridge.calls('task-vault:vault:someday-to-today')).toEqual([{ taskId: 't1' }])
    expect(bridge.calls('task-vault:vault:cancel-task')).toEqual([{ taskId: 't2' }])
    const actions = bridge
      .calls('task-vault:review:log')
      .map((c) => (c as { action: string }).action)
    expect(actions).toEqual(['task-promoted', 'task-archived'])
  })
}

function step5ProjectsTests() {
  it('promotes a someday project back to active', async () => {
    renderStep5()
    fireEvent.click(screen.getByRole('button', { name: 'Promote to active' }))
    await eventually(() => expect(screen.queryByText('Someday Projects')).toBeNull())
    expect(bridge.calls('task-vault:vault:update-project-status')).toEqual([
      { projectFilePath: 'Boat', status: 'active' },
    ])
  })
}

function step6Tests() {
  it('stores the reflection on the review and finishes', async () => {
    const onComplete = vi.fn()
    render(<WeeklyReviewStep6Reflect onComplete={onComplete} reviewId="r1" />)
    fireEvent.change(screen.getByLabelText('What worked well?'), { target: { value: 'focus' } })
    fireEvent.change(screen.getByLabelText("What didn't work?"), { target: { value: 'email' } })
    fireEvent.change(screen.getByLabelText('What will you try next week?'), {
      target: { value: 'mornings' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }))
    await eventually(() => expect(onComplete).toHaveBeenCalled())
    expect(bridge.calls('task-vault:review:complete')).toEqual([
      { reviewId: 'r1', worked: 'focus', didntWork: 'email', tryNext: 'mornings' },
    ])
  })

  it('finishes without storing anything when there is no review record', async () => {
    const onComplete = vi.fn()
    render(<WeeklyReviewStep6Reflect onComplete={onComplete} reviewId={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }))
    await eventually(() => expect(onComplete).toHaveBeenCalled())
    expect(bridge.calls('task-vault:review:complete')).toEqual([])
  })
}
