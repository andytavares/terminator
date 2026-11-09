import { Box, Text } from 'ink'
import type { Command } from '../command-names.js'
import { columns, commandWords } from '../help.js'
import { table, type Row } from '../output.js'
import { formFields, matchingCommands } from './form.js'
import { LISTS, type Snapshot } from './lists.js'
import { rowWindow, visibleRows, type Mode, type Outcome, type View } from './view.js'

const PALETTE_ROWS = 6

interface PaneProps {
  view: View
  snapshot: Snapshot | null
}

const marker = (selected: boolean) => (selected ? '▸ ' : '  ')

export function ListsPane({ view, snapshot }: PaneProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={focusColor(view, 'lists')}
      width={22}
      flexShrink={0}
    >
      {LISTS.map((list, index) => (
        <Text key={list.tool} bold={index === view.listIndex}>
          {`${marker(index === view.listIndex)}${list.title.padEnd(14)}${snapshot?.lists[index].length ?? ''}`}
        </Text>
      ))}
    </Box>
  )
}

export function RowsPane({
  view,
  snapshot,
  refreshed,
  height,
}: PaneProps & { refreshed: string; height: number }) {
  const rows = visibleRows(view, snapshot)
  const [heading = '', ...lines] =
    rows.length > 0 ? table(rows).trimEnd().split('\n') : ['No rows.']
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={focusColor(view, 'rows')}
      flexGrow={1}
    >
      <Box justifyContent="space-between">
        <Text bold>{LISTS[view.listIndex].title}</Text>
        <Text dimColor>{refreshed}</Text>
      </Box>
      <Text dimColor wrap="truncate">{`  ${heading}`}</Text>
      <RowLines view={view} lines={lines} height={height} />
    </Box>
  )
}

/** The rows that fit in `height`, scrolled so the selected one is among them. */
function RowLines({ view, lines, height }: { view: View; lines: string[]; height: number }) {
  const { start, end } = rowWindow({ selected: view.rowIndex, count: lines.length, height })
  return lines.slice(start, end).map((line, offset) => {
    const index = start + offset
    return (
      <Text key={index} wrap="truncate" inverse={view.pane === 'rows' && index === view.rowIndex}>
        {`${marker(index === view.rowIndex)}${line}`}
      </Text>
    )
  })
}

export function BottomPane({ view, snapshot, commands }: PaneProps & { commands: Command[] }) {
  return (
    <Box flexDirection="column" borderStyle="single" height={10}>
      <ModeBody
        mode={view.mode}
        commands={commands}
        row={visibleRows(view, snapshot)[view.rowIndex]}
      />
      {view.outcome && <OutcomeText outcome={view.outcome} />}
    </Box>
  )
}

function ModeBody({
  mode,
  commands,
  row,
}: {
  mode: Mode
  commands: Command[]
  row: Row | undefined
}) {
  switch (mode.kind) {
    case 'palette':
      return <PaletteBody query={mode.query} index={mode.index} commands={commands} />
    case 'form':
      return <FormBody command={mode.command} values={mode.values} field={mode.field} />
    case 'confirm':
      return <Text color="yellow">{mode.question}</Text>
    default:
      return <DetailBody row={row} />
  }
}

function DetailBody({ row }: { row: Row | undefined }) {
  if (!row) return null
  const fields = Object.entries(row).map(([key, value]): [string, string] => [
    key,
    typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value),
  ])
  return <Text wrap="truncate">{columns(fields)}</Text>
}

function PaletteBody({
  query,
  index,
  commands,
}: {
  query: string
  index: number
  commands: Command[]
}) {
  const matches = matchingCommands(commands, query)
  const first = Math.max(0, index - PALETTE_ROWS + 1)
  return (
    <>
      <Text>{`: ${query}`}</Text>
      {matches.slice(first, first + PALETTE_ROWS).map((command, offset) => (
        <Text key={command.tool.name} bold={first + offset === index}>
          {`${marker(first + offset === index)}${commandWords(command)}`}
        </Text>
      ))}
    </>
  )
}

function FormBody({
  command,
  values,
  field,
}: {
  command: Command
  values: string[]
  field: number
}) {
  return (
    <>
      <Text bold>{commandWords(command)}</Text>
      {formFields(command).map((formField, index) => (
        <Text key={formField.flag}>
          {`${marker(index === field)}--${formField.flag}${formField.required ? ' (required)' : ''}  ${values[index] ?? ''}`}
        </Text>
      ))}
    </>
  )
}

function OutcomeText({ outcome }: { outcome: Outcome }) {
  return <Text color={outcome.error ? 'red' : undefined}>{outcome.text.trimEnd()}</Text>
}

function focusColor(view: View, pane: View['pane']): string | undefined {
  return view.pane === pane ? 'cyan' : undefined
}
