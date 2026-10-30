import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePolling } from '@terminator/extension-ui'
import type { RunLogLine } from '../../ipc/run-log.js'
import { foundryInvoke } from '../../renderer/foundry-invoke.js'
import { clockOf } from '../../factory/format.js'

// The whiteboard's log: every station's words, the ledger's decisions and the command logs of
// one order, newest last. Lines come from `foundry:run-log`, which reads files only.

/** The cadence of FactoryHall's `ACTIVITY_POLL_MS`: the log is read with the agents' words. */
const RUN_LOG_POLL_MS = 2000
const FOLD_AFTER_LINES = 20
const STICK_SLACK_PX = 4

export interface RunLogProps {
  readonly orderId: string
  /** Station label to node id, for the stations that have a monitor. */
  readonly nodeByStation: Readonly<Record<string, string>>
  readonly onOpenStation: (nodeId: string) => void
  readonly onClose: () => void
}

type Kind = RunLogLine['kind']
const KIND_CHIPS: readonly (readonly [Kind, string])[] = [
  ['decision', 'Decisions'],
  ['command', 'Commands'],
  ['tool', 'Tools'],
]

/** `station:<name>` or `kind:<kind>`; null shows everything. */
type Filter = string | null

const shownBy = (line: RunLogLine, filter: Filter): boolean =>
  filter === null || filter === `station:${line.station}` || filter === `kind:${line.kind}`

interface FoldedRow {
  readonly kind: 'fold'
  readonly logPath: string
  readonly total: number
  readonly key: string
}
type Row = { readonly kind: 'line'; readonly line: RunLogLine; readonly key: string } | FoldedRow

/** The lines to draw: a command log past its first 20 lines is folded until it is expanded. */
function logRowsOf(lines: readonly RunLogLine[], expanded: ReadonlySet<string>): Row[] {
  const totals = new Map<string, number>()
  for (const line of lines) {
    if (line.logPath !== undefined) totals.set(line.logPath, (totals.get(line.logPath) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  return lines.flatMap((line, at): Row[] => {
    const key = `${at}`
    const path = line.logPath
    if (path === undefined || expanded.has(path)) return [{ kind: 'line', line, key }]
    const count = (seen.get(path) ?? 0) + 1
    seen.set(path, count)
    const total = totals.get(path) ?? count
    if (count <= FOLD_AFTER_LINES) return [{ kind: 'line', line, key }]
    return count === FOLD_AFTER_LINES + 1 ? [{ kind: 'fold', logPath: path, total, key }] : []
  })
}

function useRunLines(orderId: string): readonly RunLogLine[] {
  const [lines, setLines] = useState<readonly RunLogLine[]>([])
  const read = useCallback(async () => {
    const answer = await foundryInvoke('foundry:run-log', { orderId })
    return 'lines' in answer ? answer.lines : []
  }, [orderId])
  usePolling(read, setLines, RUN_LOG_POLL_MS)
  return lines
}

export function RunLog(props: RunLogProps): React.JSX.Element {
  const { orderId, onClose } = props
  const lines = useRunLines(orderId)
  const [filter, setFilter] = useState<Filter>(null)
  const rootRef = useRef<HTMLElement | null>(null)
  useEffect(() => rootRef.current?.focus(), [])
  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      className="fdry-runlog"
      aria-labelledby="fdry-runlog-h"
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
    >
      <header className="fdry-runlog__head">
        <h3 id="fdry-runlog-h">Run log</h3>
        <button type="button" className="fdry-hall-btn" onClick={onClose}>
          Close
        </button>
      </header>
      <RunLogChips lines={lines} filter={filter} onFilter={setFilter} />
      <RunLogList {...props} lines={lines.filter((line) => shownBy(line, filter))} />
    </section>
  )
}

interface ChipsProps {
  readonly lines: readonly RunLogLine[]
  readonly filter: Filter
  readonly onFilter: (filter: Filter) => void
}

function RunLogChips({ lines, filter, onFilter }: ChipsProps) {
  const stations = [...new Set(lines.map((line) => line.station))]
  const chips: readonly (readonly [Filter, string])[] = [
    [null, 'All'],
    ...stations.map((station): readonly [Filter, string] => [`station:${station}`, station]),
    ...KIND_CHIPS.map(([kind, name]): readonly [Filter, string] => [`kind:${kind}`, name]),
  ]
  return (
    <div className="fdry-runlog__chips">
      {chips.map(([value, name]) => (
        <button
          key={name}
          type="button"
          className="fdry-hall-btn"
          aria-pressed={filter === value}
          onClick={() => onFilter(value)}
        >
          {name}
        </button>
      ))}
    </div>
  )
}

function useFollowNewest(lines: readonly RunLogLine[]) {
  const listRef = useRef<HTMLOListElement | null>(null)
  const [following, setFollowing] = useState(true)
  useLayoutEffect(() => {
    const list = listRef.current
    if (list !== null && following) list.scrollTop = list.scrollHeight
  }, [lines, following])
  const onScroll = (): void => {
    const list = listRef.current
    if (list !== null) {
      setFollowing(list.scrollHeight - list.scrollTop - list.clientHeight <= STICK_SLACK_PX)
    }
  }
  return { listRef, following, onScroll, follow: () => setFollowing(true) }
}

function RunLogList(props: RunLogProps & { readonly lines: readonly RunLogLine[] }) {
  const { lines, nodeByStation, onOpenStation } = props
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const { listRef, following, onScroll, follow } = useFollowNewest(lines)
  const expand = (logPath: string): void => setExpanded(new Set([...expanded, logPath]))
  return (
    <>
      <ol ref={listRef} className="fdry-runlog__lines" onScroll={onScroll}>
        {logRowsOf(lines, expanded).map((row) =>
          row.kind === 'fold' ? (
            <FoldRow key={row.key} row={row} onExpand={expand} />
          ) : (
            <RunLogRow
              key={row.key}
              line={row.line}
              nodeId={nodeByStation[row.line.station]}
              onOpen={onOpenStation}
            />
          )
        )}
      </ol>
      {following ? null : (
        <button type="button" className="fdry-hall-btn is-primary" onClick={follow}>
          Jump to latest
        </button>
      )}
    </>
  )
}

function FoldRow({
  row,
  onExpand,
}: {
  readonly row: FoldedRow
  readonly onExpand: (p: string) => void
}) {
  return (
    <li>
      <button type="button" className="fdry-hall-btn" onClick={() => onExpand(row.logPath)}>
        Show all {row.total} lines
      </button>
    </li>
  )
}

interface RowProps {
  readonly line: RunLogLine
  readonly nodeId: string | undefined
  readonly onOpen: (nodeId: string) => void
}

function RunLogRow({ line, nodeId, onOpen }: RowProps) {
  return (
    <li className="fdry-runlog__line" data-kind={line.kind}>
      <time>{clockOf(line.at)}</time>
      {nodeId === undefined ? (
        <span className="fdry-runlog__station">{line.station}</span>
      ) : (
        <button type="button" className="fdry-runlog__station" onClick={() => onOpen(nodeId)}>
          {line.station}
        </button>
      )}
      <span className="fdry-runlog__text">{line.text}</span>
    </li>
  )
}
