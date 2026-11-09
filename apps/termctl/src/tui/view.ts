import type { Key } from 'ink'
import type { Command } from '../command-names.js'
import { confirmQuestion } from '../confirm.js'
import type { ToolArguments } from '../flags.js'
import type { Row } from '../output.js'
import { formArguments, formFields, matchingCommands } from './form.js'
import { LISTS, filteredRows, knownName, type Snapshot } from './lists.js'

type Browse = { kind: 'browse' }
type Filter = { kind: 'filter' }
type Palette = { kind: 'palette'; query: string; index: number }
type Form = { kind: 'form'; command: Command; values: string[]; field: number }
type Confirm = { kind: 'confirm'; command: Command; args: ToolArguments; question: string }
export type Mode = Browse | Filter | Palette | Form | Confirm

export interface Outcome {
  text: string
  error: boolean
}

export interface View {
  pane: 'lists' | 'rows'
  listIndex: number
  rowIndex: number
  filter: string
  mode: Mode
  outcome: Outcome | null
}

export const START_VIEW: View = {
  pane: 'lists',
  listIndex: LISTS.findIndex((list) => list.title === 'Tasks'),
  rowIndex: 0,
  filter: '',
  mode: { kind: 'browse' },
  outcome: null,
}

export interface Keypress {
  input: string
  key: Key
}

/** What a key can do outside the view: end the TUI, or run a command. */
export interface KeyContext {
  snapshot: Snapshot | null
  commands: Command[]
  exit: () => void
  run: (command: Command, args: ToolArguments) => void
}

type ViewIn<M extends Mode> = View & { mode: M }

const BROWSE: Browse = { kind: 'browse' }

/** The view after a key. */
export function viewAfterKey(view: View, press: Keypress, context: KeyContext): View {
  // Ink hands keys that arrive in one chunk, such as a paste, over as one input, tabs and returns included.
  // Characters, not UTF-16 units: an emoji is one key.
  const characters = [...press.input]
  if (characters.length > 1) {
    return characters.reduce(
      (current, input) => viewAfterKey(current, keypressOf(input, press.key), context),
      view
    )
  }
  const { mode } = view
  switch (mode.kind) {
    case 'browse':
      return browseKey(view, press, context)
    case 'filter':
      return filterKey(view, press)
    case 'palette':
      return paletteKey({ ...view, mode }, press, context)
    case 'form':
      return formKey({ ...view, mode }, press, context)
    case 'confirm':
      return confirmKey({ ...view, mode }, press, context)
  }
}

function keypressOf(character: string, key: Key): Keypress {
  const tab = character === '\t'
  const enter = character === '\r'
  return { input: tab || enter ? '' : character, key: { ...key, tab, return: enter } }
}

export function visibleRows(view: View, snapshot: Snapshot | null): Row[] {
  return filteredRows(snapshot?.lists[view.listIndex] ?? [], view.filter)
}

function browseKey(view: View, press: Keypress, context: KeyContext): View {
  const { input, key } = press
  if (input === 'q') {
    context.exit()
    return view
  }
  if (input === '/') return { ...view, mode: { kind: 'filter' }, outcome: null }
  if (input === ':')
    return { ...view, mode: { kind: 'palette', query: '', index: 0 }, outcome: null }
  if (key.tab) return { ...view, pane: view.pane === 'lists' ? 'rows' : 'lists' }
  if (key.return) return { ...view, pane: 'rows' }
  if (key.upArrow || key.downArrow) return moved(view, key.downArrow ? 1 : -1, context.snapshot)
  return view
}

function moved(view: View, step: number, snapshot: Snapshot | null): View {
  if (view.pane === 'lists') {
    return {
      ...view,
      listIndex: clamp(view.listIndex + step, LISTS.length),
      rowIndex: 0,
      outcome: null,
    }
  }
  const rowCount = visibleRows(view, snapshot).length
  return { ...view, rowIndex: clamp(view.rowIndex + step, rowCount), outcome: null }
}

function clamp(index: number, length: number): number {
  return Math.max(0, Math.min(index, length - 1))
}

function filterKey(view: View, press: Keypress): View {
  if (press.key.escape) return { ...view, filter: '', mode: BROWSE }
  if (press.key.return) return { ...view, mode: BROWSE }
  return { ...view, filter: edited(view.filter, press), rowIndex: 0 }
}

/** The text after a key typed into a field. */
function edited(text: string, press: Keypress): string {
  const { input, key } = press
  if (key.backspace || key.delete) return text.slice(0, -1)
  if (key.ctrl || key.meta || key.tab || key.return || key.escape) return text
  return text + input
}

function paletteKey(view: ViewIn<Palette>, press: Keypress, context: KeyContext): View {
  const { mode } = view
  const matches = matchingCommands(context.commands, mode.query)
  if (press.key.escape) return { ...view, mode: BROWSE }
  if (press.key.upArrow || press.key.downArrow) {
    const index = clamp(mode.index + (press.key.downArrow ? 1 : -1), matches.length)
    return { ...view, mode: { ...mode, index } }
  }
  if (press.key.return) {
    const command = matches[mode.index]
    return command ? { ...view, mode: { kind: 'form', command, values: [], field: 0 } } : view
  }
  return { ...view, mode: { ...mode, query: edited(mode.query, press), index: 0 } }
}

function formKey(view: ViewIn<Form>, press: Keypress, context: KeyContext): View {
  const { mode } = view
  if (press.key.escape) return { ...view, mode: BROWSE, outcome: null }
  if (press.key.return) return submitted(view, context)
  if (press.key.tab) {
    const field = (mode.field + 1) % Math.max(1, formFields(mode.command).length)
    return { ...view, mode: { ...mode, field } }
  }
  const values = [...mode.values]
  values[mode.field] = edited(values[mode.field] ?? '', press)
  return { ...view, mode: { ...mode, values } }
}

/** Runs the form's command, asks first when it is destructive, or shows why its flags fail. */
function submitted(view: ViewIn<Form>, context: KeyContext): View {
  const { command, values } = view.mode
  let args: ToolArguments
  try {
    args = formArguments(command, values)
  } catch (error) {
    return { ...view, outcome: { text: (error as Error).message, error: true } }
  }
  if (command.tool.annotations?.destructiveHint) {
    const name = knownName(args, context.snapshot?.lists.flat() ?? [])
    const question = confirmQuestion(command, name)
    return { ...view, mode: { kind: 'confirm', command, args, question }, outcome: null }
  }
  context.run(command, args)
  return { ...view, mode: BROWSE, outcome: null }
}

function confirmKey(view: ViewIn<Confirm>, press: Keypress, context: KeyContext): View {
  if (!/^y$/i.test(press.input))
    return { ...view, mode: BROWSE, outcome: { text: 'Cancelled.', error: false } }
  context.run(view.mode.command, view.mode.args)
  return { ...view, mode: BROWSE }
}

/** The slice of a list a pane `height` rows tall shows, with the selected row always in it. */
export function rowWindow({
  selected,
  count,
  height,
}: {
  selected: number
  count: number
  height: number
}) {
  const shown = Math.max(1, height)
  const start = Math.max(0, selected - shown + 1)
  return { start, end: Math.min(count, start + shown) }
}
