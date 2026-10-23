import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp } from './helpers'
import { invokeChannel, type ExtensionView } from './extension-page'
import { openVault, storedTask, localDate } from './task-vault-harness'
import { expectCentredInWindow } from './modal-centre'

// The board view and the calendar beside the log: moving cards between lanes,
// grouping and editing lanes, and jumping from a day in the calendar to a task.
// The steps run in order: the calendar reads the lanes the board saved.

interface KanbanConfig {
  swimlaneGrouping: string
  lanes: { id: string; label: string; taskStatuses: string[]; dotColor?: string }[]
}

let handle: AppHandle
let vault: ExtensionView

/** A day in this month's calendar grid other than today. */
const OTHER_DAY =
  localDate(1).slice(0, 7) === localDate(0).slice(0, 7) ? localDate(1) : localDate(-1)

function calendarDay(date: string) {
  return vault.locator('.cal-drawer__cell').filter({
    has: vault.locator('.cal-drawer__day-num').getByText(String(Number(date.slice(8))), {
      exact: true,
    }),
  })
}

function boardLane(label: string) {
  return vault
    .locator('.tv-kanban__lane')
    .filter({ has: vault.locator('.tv-kanban__lane-title', { hasText: label }) })
}

function kanbanConfig(): Promise<KanbanConfig> {
  return invokeChannel<KanbanConfig>(vault, 'task-vault:kanban:get-config')
}

test.beforeAll(async () => {
  handle = await launchApp()
  vault = await openVault(handle)
  for (const text of ['Design the logo @Rebrand', 'Pick the palette @Rebrand']) {
    await invokeChannel(vault, 'task-vault:vault:add-task', {
      filePath: `daily/${localDate(0)}.md`,
      text,
    })
  }
  await invokeChannel(vault, 'task-vault:vault:add-task', {
    filePath: `daily/${OTHER_DAY}.md`,
    text: 'Present the moodboard',
  })
  await vault.getByRole('button', { name: 'Board view' }).click()
  // The board holds every open task, whatever day it is logged on.
  await expect(boardLane('Todo').locator('.tv-kanban__card')).toHaveCount(3)
})

test.afterAll(async () => {
  await closeApp(handle)
})

/** Dragging a card to another lane gives the task that lane’s status. */
async function dragCardToLane(): Promise<void> {
  const card = boardLane('Todo').locator('.tv-kanban__card', { hasText: 'Design the logo' })
  await card.dragTo(boardLane('In Progress'))

  await expect(boardLane('In Progress').locator('.tv-kanban__card')).toHaveText([/Design the logo/])
  await expect
    .poll(() => storedTask(vault, 'Design the logo'))
    .toMatchObject({ status: 'in-progress' })
}

/** Grouping the board by project draws a swimlane per project and is remembered. */
async function groupByProject(): Promise<void> {
  await vault
    .locator('.tv-kanban__swimlane-toggle')
    .getByRole('button', { name: 'Project' })
    .click()

  await expect(vault.locator('.tv-kanban')).toContainText('Rebrand')
  expect((await kanbanConfig()).swimlaneGrouping).toBe('project')
  await vault.locator('.tv-kanban__swimlane-toggle').getByRole('button', { name: 'Off' }).click()
  await expect.poll(async () => (await kanbanConfig()).swimlaneGrouping).toBe('none')
}

/** A lane renamed and given a dot colour keeps both after saving. */
async function renameAndColourLane(): Promise<void> {
  await vault.getByTitle('Edit lanes').click()
  const editor = vault.getByRole('dialog', { name: 'Edit Kanban Lanes' })
  await expectCentredInWindow(editor, 'Task Vault: Edit Kanban Lanes')
  const todoRow = editor.locator('.tv-lane-editor__row').first()
  await todoRow.getByPlaceholder('Lane name').fill('Up next')
  await todoRow.locator('input[type="color"]').fill('#ff8800')
  await editor.getByRole('button', { name: 'Save lanes' }).click()

  await expect(boardLane('Up next')).toBeVisible()
  const saved = (await kanbanConfig()).lanes[0]
  expect(saved).toMatchObject({ label: 'Up next', taskStatuses: ['open'], dotColor: '#ff8800' })
}

/** The calendar dots a day in the colour of its lane. */
async function calendarDotColour(): Promise<void> {
  await vault.getByRole('button', { name: 'List view' }).click()
  // Reopening the vault reads the saved lanes back, as after a restart.
  await vault.reload()
  await expect(vault.locator('.cal-drawer')).toBeVisible()
  // Today still has an open task, which the renamed lane holds.
  await expect(calendarDay(localDate(0)).locator('.cal-dot').first()).toHaveCSS(
    'background-color',
    'rgb(255, 136, 0)'
  )
}

/** A task picked in the calendar opens on its day, selected. */
async function pickFromCalendar(): Promise<void> {
  await calendarDay(OTHER_DAY).click()
  await vault.locator('.cal-drawer__day-task', { hasText: 'Present the moodboard' }).click()

  await expect(vault.locator('.tv-detail-panel')).toContainText('Present the moodboard')
  await expect(
    vault.locator('.daily-log__task-text', { hasText: 'Present the moodboard' })
  ).toBeVisible()
  await expect(vault.locator('.daily-log__today-badge')).toHaveCount(0)
}

const ORGANISING_THE_BOARD: [string, () => Promise<void>][] = [
  ['dragging a card to another lane gives the task that lane’s status', dragCardToLane],
  ['grouping the board by project draws a swimlane per project and is remembered', groupByProject],
  ['a lane renamed and given a dot colour keeps both after saving', renameAndColourLane],
  ['the calendar dots a day in the colour of its lane', calendarDotColour],
  ['a task picked in the calendar opens on its day, selected', pickFromCalendar],
]

test("the board and the calendar organise the week's work", async () => {
  for (const [title, step] of ORGANISING_THE_BOARD) await test.step(title, step)
})
