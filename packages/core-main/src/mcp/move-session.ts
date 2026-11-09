import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { HomeAsk } from '../../../core-shared/src/schemas/home-feed.schema.js'
import { SESSION_ID } from '../../../core-shared/src/session-id.js'
import { publishAsks, setActionHandler } from '../home/home-feed.js'
import { notificationManager } from '../notifications/notification-manager.js'
import { callRendererTool } from './renderer-tools.js'
import { toolMarks, type McpCaller, type McpToolDef, type ToolProvider } from './tool-types.js'

// `move_session_here` (a Move): a Claude Code session in another app moves to a Terminator
// terminal tab. Terminator waits for the source claude to exit, because two processes on one
// live session can write over each other's transcript.

const SOURCE = 'claude-moves'
const TITLE = 'A Claude session is moving here'

/** @internal What the move needs from the machine; specs pass fakes. */
export interface MoveDeps {
  /** `~/.claude/projects`: one folder per project, one `<id>.jsonl` transcript per session. */
  projectsRoot: string
  isRunning: (pid: number) => boolean
  /** Calls `check` each second until the returned stop is called. */
  everySecond: (check: () => Promise<void>) => () => void
}

interface MoveTarget {
  id: string
  cwd: string
  workspace?: string
}

interface Move extends MoveTarget {
  ask: HomeAsk
  stopWatching: () => void
}

async function transcriptPath(root: string, id: string): Promise<string | null> {
  const projects = await readdir(root).catch(() => [])
  for (const project of projects) {
    const path = join(root, project, `${id}.jsonl`)
    if (
      await readFile(path, 'utf8').then(
        () => true,
        () => false
      )
    )
      return path
  }
  return null
}

function lastCwd(transcript: string): string | null {
  for (const line of transcript.split('\n').reverse()) {
    try {
      const cwd = (JSON.parse(line) as { cwd?: unknown }).cwd
      if (typeof cwd === 'string') return cwd
    } catch {
      // A line cut short while claude was writing it; the one before still counts.
    }
  }
  return null
}

async function sessionFolder(root: string, id: string): Promise<string> {
  const path = await transcriptPath(root, id)
  if (!path)
    throw new Error(`No Claude transcript has this session's id (${id}), so it cannot move.`)
  const cwd = lastCwd(await readFile(path, 'utf8'))
  if (!cwd) throw new Error("This session's transcript names no folder, so it cannot move.")
  return cwd
}

const tilde = (path: string): string =>
  path.startsWith(homedir()) ? `~${path.slice(homedir().length)}` : path

function movingAsk(id: string, cwd: string): HomeAsk {
  return {
    id: `move-${id}`,
    kind: 'decide',
    title: TITLE,
    detail: 'It opens in a terminal tab as soon as you exit it there.',
    where: `Claude · ${tilde(cwd)}`,
    facts: [],
    workKey: null,
    since: new Date().toISOString(),
    actions: [
      { id: 'open-copy', label: 'Open a copy now', primary: true },
      { id: 'cancel', label: 'Cancel' },
    ],
    // Home needs somewhere to go; with no session this does nothing.
    open: { command: 'core:reveal-session' },
  }
}

function readWorkspace(args: Record<string, unknown>): string | undefined {
  return typeof args.workspace === 'string' && args.workspace !== '' ? args.workspace : undefined
}

function refuseWithoutId(caller: McpCaller): string {
  const id = caller.sessionId
  if (id === null || !SESSION_ID.test(id)) {
    throw new Error('This session did not report its id, so it cannot move.')
  }
  return id
}

/** The moves waiting on Home, keyed by session id. */
type Moves = Map<string, Move>

function publishMoves(moves: Moves): void {
  publishAsks(
    SOURCE,
    [...moves.values()].map((move) => move.ask)
  )
}

function endMove(moves: Moves, move: Move): void {
  move.stopWatching()
  if (moves.get(move.id) === move) moves.delete(move.id)
  publishMoves(moves)
}

/** Opens the tab; on failure the row stays and says why. */
async function openMove(moves: Moves, move: Move, fork: boolean): Promise<void> {
  move.stopWatching()
  const command = `claude --resume ${move.id}${fork ? ' --fork-session' : ''}`
  try {
    await callRendererTool('open_terminal', { cwd: move.cwd, command, workspace: move.workspace })
    endMove(moves, move)
  } catch (error) {
    const detail = `The terminal tab did not open: ${(error as Error).message}`
    // The session has ended, so nothing watches for it any more: Try again resumes it by hand.
    const actions = fork ? move.ask.actions : [RETRY, ...move.ask.actions]
    move.ask = { ...move.ask, detail, actions: dropRepeats(actions) }
    publishMoves(moves)
  }
}

/** A second move of one session id replaces the first. */
function startMove(moves: Moves, target: MoveTarget, watch: (move: Move) => () => void): Move {
  moves.get(target.id)?.stopWatching()
  const move: Move = { ...target, ask: movingAsk(target.id, target.cwd), stopWatching: () => {} }
  move.stopWatching = watch(move)
  moves.set(target.id, move)
  publishMoves(moves)
  return move
}

const RETRY = { id: 'retry', label: 'Try again', primary: true }
const dropRepeats = (actions: HomeAsk['actions']): HomeAsk['actions'] =>
  actions
    .filter((action, index) => actions.findIndex((other) => other.id === action.id) === index)
    .map((action) => (action.id === RETRY.id ? action : { ...action, primary: false }))

async function actOnMove(moves: Moves, askId: string, actionId: string): Promise<void> {
  const move = [...moves.values()].find((candidate) => candidate.ask.id === askId)
  if (move && actionId === 'retry') await openMove(moves, move, false)
  if (move && actionId === 'open-copy') await openMove(moves, move, true)
  if (move && actionId === 'cancel') endMove(moves, move)
}

const MOVING_MESSAGE =
  'Exit this session now (/exit, or close it in the Claude app). Terminator opens it as soon as it ends.'

const MOVE_TOOL = {
  name: 'move_session_here',
  description:
    'Moves this Claude Code session to a Terminator terminal tab, which runs claude --resume ' +
    'once this session exits. `workspace` names the Terminator workspace to open it in.',
  inputSchema: {
    type: 'object',
    properties: { workspace: { type: 'string', description: 'A Terminator workspace name.' } },
  },
}

/** @internal The move tool over `deps`; the app uses `moveSessionTool`. */
export function createMoveSession(deps: MoveDeps): ToolProvider {
  const moves: Moves = new Map()
  setActionHandler(SOURCE, (askId, actionId) => actOnMove(moves, askId, actionId))
  const watch = (claudePid: number) => (move: Move) =>
    deps.everySecond(async () => {
      if (!deps.isRunning(claudePid)) await openMove(moves, move, false)
    })
  const moveSessionHere: McpToolDef = {
    ...MOVE_TOOL,
    ...toolMarks({ destructive: false, readOnly: false }),
    call: async (args, caller) => {
      const id = refuseWithoutId(caller)
      const cwd = await sessionFolder(deps.projectsRoot, id)
      const move = startMove(
        moves,
        { id, cwd, workspace: readWorkspace(args) },
        watch(caller.claudePid)
      )
      void notificationManager.create({
        type: 'info',
        title: TITLE,
        message: move.ask.where!,
        key: 'sessionMoving',
      })
      return { moving: true, message: MOVING_MESSAGE }
    },
  }
  return { tools: () => [moveSessionHere] }
}

/** ESRCH means the process is gone; EPERM means it runs under another user, so it is still there. */
function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function everySecond(check: () => Promise<void>): () => void {
  const timer = setInterval(() => void check(), 1000)
  timer.unref()
  return () => clearInterval(timer)
}

export const moveSessionTool = createMoveSession({
  projectsRoot: join(homedir(), '.claude', 'projects'),
  isRunning: processIsRunning,
  everySecond,
})
