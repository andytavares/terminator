import React, { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, screen, cleanup, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installVaultBridge, eventually, indexedProject } from './helpers/bridge'
import { SmartTaskInput, invalidateSmartInputCache } from '../../src/components/SmartTaskInput'

let bridge: ReturnType<typeof installVaultBridge>
const getSettingsValues = vi.fn()

beforeEach(() => {
  invalidateSmartInputCache()
  getSettingsValues.mockResolvedValue({
    values: { 'terminator.task-vault.contexts': 'home, desk' },
  })
  bridge = installVaultBridge({ extension: { getSettingsValues } })
  bridge.responses['task-vault:projects:list'] = {
    projects: [indexedProject('Launch Plan'), indexedProject('Garden')],
  }
  bridge.responses['task-vault:vault:list-areas'] = { areas: [{ name: 'Work', filePath: 'Work' }] }
})

afterEach(() => cleanup())

interface Spies {
  onSubmit: Mock<() => void>
  onCancel: Mock<() => void>
  changes: string[]
}

function InputHarness({ spies, initial }: { spies: Spies; initial: string }) {
  const [value, setValue] = useState(initial)
  return (
    <SmartTaskInput
      value={value}
      onChange={(v) => {
        spies.changes.push(v)
        setValue(v)
      }}
      onSubmit={spies.onSubmit}
      onCancel={spies.onCancel}
      className="extra"
    />
  )
}

async function renderSmartInput(initial = '') {
  const spies: Spies = { onSubmit: vi.fn<() => void>(), onCancel: vi.fn<() => void>(), changes: [] }
  const user = userEvent.setup()
  render(<InputHarness spies={spies} initial={initial} />)
  await eventually(() => expect(getSettingsValues).toHaveBeenCalled())
  await act(async () => {})
  return { user, spies, input: screen.getByRole('textbox') as HTMLInputElement }
}

const optionTexts = () =>
  within(screen.getByRole('group', { name: 'Suggestions' }))
    .getAllByRole('button')
    .map((option) => option.textContent)
const selectedOption = () => screen.getByRole('button', { current: true }).textContent

describe('SmartTaskInput suggestions', suggestionTests)
describe('SmartTaskInput choosing', optionChoosingTests)
describe('SmartTaskInput keyboard', keyboardTests)
describe('SmartTaskInput blank submit', emptySubmitTests)
describe('SmartTaskInput dates', dateTests)

function suggestionTests() {
  describe('projects', suggestionProjectsTests)
  describe('areas and contexts', suggestionAreasAndContextsTests)
}

function suggestionProjectsTests() {
  it('suggests projects for @, with a create option for a new name', async () => {
    const { user, input } = await renderSmartInput()
    await user.type(input, 'Call @la')
    expect(screen.getByText('Projects')).toBeTruthy()
    expect(optionTexts()).toEqual(['@Launch Plan', '+Create "@la"'])
    expect(input.className).toBe('smart-input__field extra')
  })

  it('treats hyphens as spaces and offers no create option for an exact name', async () => {
    const { user, input } = await renderSmartInput()
    await user.type(input, '@launch-plan')
    expect(optionTexts()).toEqual(['@Launch Plan'])
  })
}

function suggestionAreasAndContextsTests() {
  it('suggests areas for #', async () => {
    const { user, input } = await renderSmartInput()
    await user.type(input, 'x #')
    expect(screen.getByText('Areas')).toBeTruthy()
    expect(optionTexts()).toEqual(['#Work'])
  })

  it('suggests contexts for + from the settings', async () => {
    const { user, input } = await renderSmartInput()
    await user.type(input, 'x +')
    expect(screen.getByText('Contexts')).toBeTruthy()
    expect(optionTexts()).toEqual(['+home', '+desk'])
  })

  it('says No matches when no context fits the typed tag', async () => {
    const { user, input } = await renderSmartInput()
    await user.type(input, 'x +zzz')
    expect(screen.getByText('No matches')).toBeTruthy()
  })

  it('falls back to the default contexts when none are set', async () => {
    getSettingsValues.mockResolvedValue({ values: {} })
    const { user, input } = await renderSmartInput()
    await user.type(input, '+')
    expect(optionTexts()).toEqual(['+home', '+work', '+computer', '+phone', '+errands'])
  })
}

function optionChoosingTests() {
  describe('inserting', optionInsertingTests)
  describe('creating', optionCreatingTests)
}

function optionInsertingTests() {
  it('inserts the chosen project as a slug at the caret and closes the list', async () => {
    const { user, input, spies } = await renderSmartInput()
    await user.type(input, 'Call  tomorrow')
    await user.type(input, '@la', { initialSelectionStart: 5, initialSelectionEnd: 5 })
    await user.click(screen.getByText('Launch Plan'))
    await eventually(() => expect(input.value).toBe('Call @Launch-Plan tomorrow'))
    expect(screen.queryByRole('group', { name: 'Suggestions' })).toBeNull()
    expect(spies.changes.at(-1)).toBe('Call @Launch-Plan tomorrow')
  })
}

function optionCreatingTests() {
  it('creates a new project before inserting it', async () => {
    const { user, input } = await renderSmartInput()
    await user.type(input, '@Boat')
    await user.click(screen.getByText(/Create "@/))
    await eventually(() => expect(input.value).toBe('@Boat '))
    expect(bridge.calls('task-vault:projects:create')).toEqual([{ name: 'Boat' }])
  })

  it('creates a new area before inserting it', async () => {
    const { user, input } = await renderSmartInput()
    await user.type(input, '#Sea')
    await user.click(screen.getByText(/Create "#/))
    await eventually(() => expect(input.value).toBe('#Sea '))
    expect(bridge.calls('task-vault:vault:create-area')).toEqual([{ name: 'Sea' }])
  })

  it('still inserts the tag when creating it fails', async () => {
    bridge.responses['task-vault:projects:create'] = () => {
      throw new Error('nope')
    }
    const { user, input } = await renderSmartInput()
    await user.type(input, '@Boat')
    await user.click(screen.getByText(/Create "@/))
    await eventually(() => expect(input.value).toBe('@Boat '))
  })
}

function keyboardTests() {
  describe('choosing', keyboardChoosingTests)
  describe('hyphens', keyboardHyphensTests)
  describe('escape', keyboardEscapeTests)
  describe('enter', keyboardEnterTests)
}

function keyboardChoosingTests() {
  it('moves the selection with the arrows and the pointer', async () => {
    const { user, input } = await renderSmartInput()
    await user.type(input, '@')
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}')
    expect(selectedOption()).toBe('@Launch Plan')
    await user.hover(screen.getByText('Garden'))
    expect(selectedOption()).toBe('@Garden')
  })

  it('inserts the selected suggestion on Enter', async () => {
    const { user, input } = await renderSmartInput()
    await user.type(input, '@')
    await user.keyboard('{ArrowDown}{Enter}')
    await eventually(() => expect(input.value).toBe('@Garden '))
  })

  it('inserts the selected suggestion on Tab', async () => {
    const { user, input } = await renderSmartInput()
    await user.type(input, 'x #')
    await user.keyboard('{Tab}')
    await eventually(() => expect(input.value).toBe('x #Work '))
  })
}

function keyboardHyphensTests() {
  it('turns a space inside a tag into a hyphen', async () => {
    const { user, input } = await renderSmartInput()
    await user.type(input, '@launch ')
    expect(input.value).toBe('@launch-')
    expect(optionTexts()).toEqual(['@Launch Plan', '+Create "@launch-"'])
  })
}

function keyboardEscapeTests() {
  it('closes suggestions on Escape, then cancels on a second Escape', async () => {
    const { user, input, spies } = await renderSmartInput()
    await user.type(input, '@')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('group', { name: 'Suggestions' })).toBeNull()
    expect(spies.onCancel).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(spies.onCancel).toHaveBeenCalledTimes(1)
  })

  it('does not cancel on Escape while a tag with no matches is open', async () => {
    const { user, input, spies } = await renderSmartInput()
    await user.type(input, 'x +zz')
    await user.keyboard('{Escape}')
    expect(spies.onCancel).not.toHaveBeenCalled()
  })
}

function keyboardEnterTests() {
  it('only closes an open tag with no matches on Enter, without submitting', async () => {
    const { user, input, spies } = await renderSmartInput()
    await user.type(input, 'x +zzz')
    await user.keyboard('{Enter}')
    expect(spies.onSubmit).not.toHaveBeenCalled()
    expect(screen.queryByRole('group', { name: 'Suggestions' })).toBeNull()
  })

  it('submits on Enter once no tag is open, and counts the task created', async () => {
    const { user, input, spies } = await renderSmartInput()
    await user.type(input, 'x +zzz{Enter}')
    await user.keyboard('{Enter}')
    expect(spies.onSubmit).toHaveBeenCalledTimes(1)
    expect(bridge.recordUsage.mock.calls).toEqual([['task-create']])
  })
}

function emptySubmitTests() {
  it('does not count a submit of blank text', async () => {
    const { user, input } = await renderSmartInput()
    await user.type(input, '{Enter}')
    expect(bridge.recordUsage).not.toHaveBeenCalled()
  })
}

function dateTests() {
  it('opens a date picker for due: and inserts the chosen date', async () => {
    const { user, input } = await renderSmartInput()
    await user.type(input, 'Pay due:')
    await user.click(screen.getByText('Today'))
    const d = new Date()
    const twoDigitsOf = (n: number) => String(n).padStart(2, '0')
    const today = `${d.getFullYear()}-${twoDigitsOf(d.getMonth() + 1)}-${twoDigitsOf(d.getDate())}`
    await eventually(() => expect(input.value).toBe(`Pay due:${today} `))
    expect(screen.queryByRole('group', { name: 'Suggestions' })).toBeNull()
  })

  it('removes the due: trigger when the date is cleared', async () => {
    const { user, input } = await renderSmartInput()
    await user.type(input, 'Pay due:2026-03-04')
    await user.click(screen.getByText('Clear'))
    await eventually(() => expect(input.value).toBe('Pay '))
  })
}
