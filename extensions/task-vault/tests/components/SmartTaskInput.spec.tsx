import React, { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
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
  render(<InputHarness spies={spies} initial={initial} />)
  await eventually(() => expect(getSettingsValues).toHaveBeenCalled())
  await act(async () => {})
  return { spies, input: screen.getByRole('textbox') as HTMLInputElement }
}

function typeInto(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value, selectionStart: value.length } })
}

const optionTexts = () =>
  Array.from(document.querySelectorAll('.smart-input__option')).map((b) => b.textContent)

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
    const { input } = await renderSmartInput()
    typeInto(input, 'Call @la')
    expect(screen.getByText('Projects')).toBeTruthy()
    expect(optionTexts()).toEqual(['@Launch Plan', '+Create "@la"'])
    expect(input.className).toBe('smart-input__field extra')
  })

  it('treats hyphens as spaces and offers no create option for an exact name', async () => {
    const { input } = await renderSmartInput()
    typeInto(input, '@launch-plan')
    expect(optionTexts()).toEqual(['@Launch Plan'])
  })
}

function suggestionAreasAndContextsTests() {
  it('suggests areas for # and contexts for + from the settings', async () => {
    const { input } = await renderSmartInput()
    typeInto(input, 'x #')
    expect(screen.getByText('Areas')).toBeTruthy()
    expect(optionTexts()).toEqual(['#Work'])
    typeInto(input, 'x +')
    expect(screen.getByText('Contexts')).toBeTruthy()
    expect(optionTexts()).toEqual(['+home', '+desk'])
    typeInto(input, 'x +zzz')
    expect(screen.getByText('No matches')).toBeTruthy()
  })

  it('falls back to the default contexts when none are set', async () => {
    getSettingsValues.mockResolvedValue({ values: {} })
    const { input } = await renderSmartInput()
    typeInto(input, '+')
    expect(optionTexts()).toEqual(['+home', '+work', '+computer', '+phone', '+errands'])
  })
}

function optionChoosingTests() {
  it('inserts the chosen project as a slug and closes the list', async () => {
    const { input, spies } = await renderSmartInput()
    fireEvent.change(input, { target: { value: 'Call @la tomorrow', selectionStart: 8 } })
    fireEvent.click(screen.getByText('Launch Plan'))
    await eventually(() => expect(input.value).toBe('Call @Launch-Plan tomorrow'))
    expect(document.querySelector('.smart-input__dropdown')).toBeNull()
    expect(spies.changes.at(-1)).toBe('Call @Launch-Plan tomorrow')
  })

  it('creates a new project or area before inserting it', async () => {
    const { input } = await renderSmartInput()
    typeInto(input, '@Boat')
    fireEvent.click(screen.getByText(/Create "@/))
    await eventually(() => expect(input.value).toBe('@Boat '))
    expect(bridge.calls('task-vault:projects:create')).toEqual([{ name: 'Boat' }])
    typeInto(input, '@Boat #Sea')
    fireEvent.click(screen.getByText(/Create "#/))
    await eventually(() => expect(input.value).toBe('@Boat #Sea '))
    expect(bridge.calls('task-vault:vault:create-area')).toEqual([{ name: 'Sea' }])
  })

  it('still inserts the tag when creating it fails', async () => {
    bridge.responses['task-vault:projects:create'] = () => {
      throw new Error('nope')
    }
    const { input } = await renderSmartInput()
    typeInto(input, '@Boat')
    fireEvent.click(screen.getByText(/Create "@/))
    await eventually(() => expect(input.value).toBe('@Boat '))
  })
}

function keyboardTests() {
  describe('choosing', keyboardChoosingTests)
  describe('hyphens', keyboardHyphensTests)
  describe('escape and enter', keyboardEscapeAndEnterTests)
}

function keyboardChoosingTests() {
  it('moves through suggestions with the arrows and picks with Enter or Tab', async () => {
    const { input } = await renderSmartInput()
    typeInto(input, '@')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.mouseEnter(screen.getByText('Garden'))
    expect(document.querySelector('.smart-input__option--selected')?.textContent).toBe('@Garden')
    fireEvent.keyDown(input, { key: 'Enter' })
    await eventually(() => expect(input.value).toBe('@Garden '))
    typeInto(input, '@Garden #')
    fireEvent.keyDown(input, { key: 'Tab' })
    await eventually(() => expect(input.value).toBe('@Garden #Work '))
  })
}

function keyboardHyphensTests() {
  it('turns a space inside a tag into a hyphen', async () => {
    const { input } = await renderSmartInput()
    typeInto(input, '@launch')
    input.setSelectionRange(7, 7)
    fireEvent.keyDown(input, { key: ' ' })
    expect(input.value).toBe('@launch-')
    expect(optionTexts()).toEqual(['@Launch Plan', '+Create "@launch-"'])
  })
}

function keyboardEscapeAndEnterTests() {
  it('closes suggestions on Escape, then cancels on a second Escape', async () => {
    const { input, spies } = await renderSmartInput()
    typeInto(input, '@')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(document.querySelector('.smart-input__dropdown')).toBeNull()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(spies.onCancel).toHaveBeenCalledTimes(1)
  })

  it('submits on Enter, but only closes an open trigger with no suggestions', async () => {
    const { input, spies } = await renderSmartInput()
    typeInto(input, 'x +zzz')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(spies.onSubmit).not.toHaveBeenCalled()
    expect(document.querySelector('.smart-input__dropdown')).toBeNull()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(spies.onSubmit).toHaveBeenCalledTimes(1)
    expect(bridge.recordUsage.mock.calls).toEqual([['task-create']])
    typeInto(input, 'x +zz')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(spies.onCancel).not.toHaveBeenCalled()
  })
}

function emptySubmitTests() {
  it('does not count a submit of blank text', async () => {
    const { input } = await renderSmartInput()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(bridge.recordUsage).not.toHaveBeenCalled()
  })
}

function dateTests() {
  it('opens a date picker for due: and inserts the chosen date', async () => {
    const { input } = await renderSmartInput()
    typeInto(input, 'Pay due:')
    fireEvent.click(screen.getByText('Today'))
    const d = new Date()
    const twoDigitsOf = (n: number) => String(n).padStart(2, '0')
    const today = `${d.getFullYear()}-${twoDigitsOf(d.getMonth() + 1)}-${twoDigitsOf(d.getDate())}`
    await eventually(() => expect(input.value).toBe(`Pay due:${today} `))
    expect(document.querySelector('.smart-input__dropdown')).toBeNull()
  })

  it('removes the due: trigger when the date is cleared', async () => {
    const { input } = await renderSmartInput()
    typeInto(input, 'Pay due:2026-03-04')
    fireEvent.click(screen.getByText('Clear'))
    await eventually(() => expect(input.value).toBe('Pay '))
  })
}
