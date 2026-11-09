import { useEffect, useRef, useState } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import { callToolText, type ToolClient } from '../cli.js'
import type { Command } from '../command-names.js'
import type { ToolArguments } from '../flags.js'
import { formatResult } from '../output.js'
import { loadSnapshot, type Snapshot } from './lists.js'
import { BottomPane, ListsPane, RowsPane } from './panes.js'
import type { TuiClock, TuiTerminal } from './run.js'
import { START_VIEW, viewAfterKey, type View } from './view.js'

// Header, footer, the bottom pane (10), and the rows pane's border, title and column heading.
const ROWS_PANE_CHROME = 16

const REFRESH_MS = 2000
const TICK_MS = 1000
const FOOTER = ' ↑↓ move  ⏎ open  Tab pane  : command  / filter  q quit'

interface AppProps {
  client: ToolClient
  commands: Command[]
  terminal: TuiTerminal
}

export function TuiApp({ client, commands, terminal }: AppProps) {
  const { snapshot, now } = useSnapshot(client, terminal.clock)
  const view = useTuiView(client, commands, snapshot)
  const height = terminal.stdout.rows ?? 24
  return (
    <Box flexDirection="column" height={height}>
      <Text>{header(snapshot, terminal)}</Text>
      <Box flexGrow={1}>
        <ListsPane view={view} snapshot={snapshot} />
        <Box flexDirection="column" flexGrow={1}>
          <RowsPane
            view={view}
            snapshot={snapshot}
            refreshed={refreshedText(snapshot, now)}
            height={height - ROWS_PANE_CHROME}
          />
          <BottomPane view={view} snapshot={snapshot} commands={commands} />
        </Box>
      </Box>
      <Text>{view.mode.kind === 'filter' ? ` / ${view.filter}` : FOOTER}</Text>
    </Box>
  )
}

/** The view, moved by each key, with each command's result or error shown in it. */
function useTuiView(client: ToolClient, commands: Command[], snapshot: Snapshot | null): View {
  const { exit } = useApp()
  const [view, setView] = useState(START_VIEW)
  // Keys can arrive faster than React renders, so each key starts from the last key's view.
  const latest = useRef(view)
  const show = (next: View) => {
    latest.current = next
    setView(next)
  }
  const shown = (outcome: View['outcome']) => show({ ...latest.current, outcome })
  const run = (command: Command, args: ToolArguments) =>
    void callToolText(client, command.tool.name, args).then(
      (text) => shown({ text: formatResult(text, { json: false }), error: false }),
      (error: Error) => shown({ text: error.message, error: true })
    )
  useInput((input, key) =>
    show(viewAfterKey(latest.current, { input, key }, { snapshot, commands, exit, run }))
  )
  return view
}

/** The lists, loaded now and again every REFRESH_MS, and the time, read every TICK_MS. */
function useSnapshot(client: ToolClient, clock: TuiClock) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [now, setNow] = useState(clock.now())
  useEffect(() => {
    const refresh = () => void loadSnapshot(client, clock.now).then(setSnapshot)
    refresh()
    const stopRefresh = clock.every(REFRESH_MS, refresh)
    const stopTick = clock.every(TICK_MS, () => setNow(clock.now()))
    return () => {
      stopRefresh()
      stopTick()
    }
  }, [client, clock])
  return { snapshot, now }
}

function header(snapshot: Snapshot | null, { cwd, home }: TuiTerminal): string {
  const place = cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd
  return `termctl · Terminator ${snapshot?.version ?? ''} · ${place}`
}

function refreshedText(snapshot: Snapshot | null, now: number): string {
  if (!snapshot) return 'loading'
  return `refreshed ${Math.max(0, Math.round((now - snapshot.loadedAt) / 1000))}s ago`
}
