import { expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

// Processes a closed app left behind: those with the launch's marker in their environment, and
// those in the tree taken before the close (git and gh get a fresh environment). Leaks add up
// until fork fails with EAGAIN (macOS run 38344908607); docs/CONTRIBUTING.md, "E2E rules".

const LAUNCH_MARKER = 'TERMINATOR_E2E_LAUNCH'

/** One line of `ps`: the process, its parent, and how it was started. */
export interface ProcessRow {
  pid: number
  ppid: number
  command: string
}

/** A fresh marker, and the environment entry that carries it. */
export function launchMarker(): { launchId: string; env: Record<string, string> } {
  const launchId = randomUUID()
  return { launchId, env: { [LAUNCH_MARKER]: launchId } }
}

function ps(args: string[]): string {
  return execFileSync('ps', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

/** `ps -o pid=,ppid=,command=` output as rows; the keywords are the same on Linux and macOS. */
export function parseProcessTable(output: string): ProcessRow[] {
  return output
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((match) => match !== null)
    .map(([, pid, ppid, command]) => ({ pid: Number(pid), ppid: Number(ppid), command }))
}

/** Every process under `rootPid`, at any depth, and not the root itself. */
export function descendantsOf(rows: ProcessRow[], rootPid: number): ProcessRow[] {
  const found: ProcessRow[] = []
  const parents = new Set([rootPid])
  for (let grew = true; grew; ) {
    const children = rows.filter((row) => parents.has(row.ppid) && !parents.has(row.pid))
    for (const child of children) parents.add(child.pid)
    found.push(...children)
    grew = children.length > 0
  }
  return found
}

/** Of `started`, those still running: the same pid with the same command, so a
 * pid the system has since handed to an unrelated process does not count. */
export function stillRunning(started: ProcessRow[], now: ProcessRow[]): ProcessRow[] {
  const running = new Map(now.map((row) => [row.pid, row.command]))
  return started.filter((row) => running.get(row.pid) === row.command)
}

function processTable(): ProcessRow[] {
  return parseProcessTable(ps(['-A', '-ww', '-o', 'pid=,ppid=,command=']))
}

/** The app's process tree right now, for `expectNoProcessesLeft` to check once it has closed. */
export function appProcessTree(appPid: number): ProcessRow[] {
  return descendantsOf(processTable(), appPid)
}

/** Pids with the launch's marker. `ps` prints the environment with `e` on Linux and `-E` on
 * macOS (https://man7.org/linux/man-pages/man1/ps.1.html, https://keith.github.io/xcode-man-pages/ps.1.html);
 * it is only matched, never shown: it holds the runner's tokens. */
function markedPids(launchId: string): Set<number> {
  const env = process.platform === 'darwin' ? ['-E'] : ['e']
  const mark = `${LAUNCH_MARKER}=${launchId}`
  const lines = ps(['-A', ...env, '-ww', '-o', 'pid=,command=']).split('\n')
  return new Set(
    lines.filter((line) => line.includes(mark)).map((line) => Number.parseInt(line, 10))
  )
}

/** What outlived the app: marked processes and survivors of its tree. */
function leftovers(launchId: string, started: ProcessRow[]): ProcessRow[] {
  const marked = markedPids(launchId)
  const now = processTable()
  return [
    ...now.filter((row) => marked.has(row.pid)),
    ...stillRunning(started, now).filter((row) => !marked.has(row.pid)),
  ]
}

function describeRow(row: ProcessRow): string {
  return `${row.pid} ${row.command}`.slice(0, 160)
}

/** Fails when processes the app started outlive it, after killing them and
 * everything they started, so one leak does not carry into the next spec.
 * `started` is the app's process tree taken before it was closed (`appProcessTree`). */
export async function expectNoProcessesLeft(
  launchId: string,
  started: ProcessRow[]
): Promise<void> {
  const describeLeft = (): string[] => leftovers(launchId, started).map(describeRow)
  try {
    await expect.poll(describeLeft).toEqual([])
  } catch {
    const left = leftovers(launchId, started)
    if (left.length === 0) return
    const killed = killTrees(left.map((row) => row.pid))
    const summary = `The app left ${left.length} process(es) running, and killed ${killed - left.length} it started`
    throw new Error(`${summary}:\n${left.map(describeRow).join('\n')}`)
  }
}

/** Kills `roots` and every process under them; returns how many. A leftover can still be
 * forking (macOS run 38380127678), so the tree is stopped until a listing finds nothing new,
 * then killed: killing first hands children to init (https://man7.org/linux/man-pages/man7/signal.7.html). */
function killTrees(roots: number[]): number {
  const stopped = new Set<number>()
  for (let grew = true; grew; ) {
    const table = processTable()
    const tree = roots.flatMap((pid) => [pid, ...descendantsOf(table, pid).map((row) => row.pid)])
    const fresh = tree.filter((pid) => !stopped.has(pid))
    for (const pid of fresh) signalQuietly(pid, 'SIGSTOP')
    for (const pid of fresh) stopped.add(pid)
    grew = fresh.length > 0
  }
  for (const pid of stopped) signalQuietly(pid, 'SIGKILL')
  return stopped.size
}

function signalQuietly(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal)
  } catch {
    // Gone between the listing and the signal.
  }
}
