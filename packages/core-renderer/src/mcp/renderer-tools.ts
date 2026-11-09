import type { z } from 'zod'
// Types only: zod stays out of the renderer bundle.
import type {
  RENDERER_TOOLS,
  McpAnswer,
  McpCall,
  RendererToolName,
} from '../../../core-shared/src/mcp/renderer-tools'
import { SCRATCH_PROJECT_ID, type Workspace } from '../../../core-shared/src/types/index'
import type { QuickAction } from '../quick-actions/types'
import { useSessionStore } from '../stores/session.store'
import { useSettingsStore } from '../stores/settings.store'
import { useWorkspaceStore } from '../stores/workspace.store'
import { globalStartFailure, startWork } from '../components/home/start-work'
import { startGlobalPrompt } from '../terminal/start-session'
import { createTerminalSession } from '../terminal/session-controller'
import { revealSession } from '../terminal/navigate-to-session'
import { breakOut } from '../terminal/breakout'

// The Terminator MCP server's screen tools, run in the renderer. Main parses the args against
// the tool's schema before it sends the call (packages/core-main/src/mcp/renderer-tools.ts).

type ToolArgs<Tool extends RendererToolName> = z.infer<(typeof RENDERER_TOOLS)[Tool]['input']>
type ToolHandlers = {
  [Tool in RendererToolName]: (args: ToolArgs<Tool>, actions: QuickAction[]) => unknown
}

/** The tools that need the quick-action list the palette shows. */
export const QUICK_ACTION_TOOLS: ReadonlySet<string> = new Set([
  'list_quick_actions',
  'run_quick_action',
  'run_destructive_quick_action',
])

const HANDLERS: ToolHandlers = {
  start_work: startWorkTool,
  open_session: ({ sessionId }) => revealToolSession(sessionId),
  open_terminal: openTerminal,
  open_in_window: ({ sessionId }) => openInWindow(sessionId),
  list_quick_actions: (_args, actions) => actions.map(describeAction),
  run_quick_action: ({ id }, actions) => runQuickAction(actions, id, false),
  run_destructive_quick_action: ({ id }, actions) => runQuickAction(actions, id, true),
  run_extension_command: (args) => runExtensionCommand(args, false),
  run_destructive_extension_command: (args) => runExtensionCommand(args, true),
}

/** Runs one call from main and always answers it, with the result or a plain-words error. */
export async function answerCall(call: McpCall, actions: QuickAction[]): Promise<void> {
  await window.electronAPI.mcp.answer(await toolAnswer(call, actions))
}

async function toolAnswer(call: McpCall, actions: QuickAction[]): Promise<McpAnswer> {
  const { id, tool } = call
  if (!Object.keys(HANDLERS).includes(tool))
    return { id, error: `Terminator has no tool named ${tool}.` }
  try {
    const handler = HANDLERS[tool] as (args: unknown, actions: QuickAction[]) => unknown
    return { id, result: await handler(call.args ?? {}, actions) }
  } catch (error: unknown) {
    return { id, error: error instanceof Error ? error.message : 'The tool did not finish.' }
  }
}

/** The workspace with this name or id; an error naming the known ones when there is none. */
function findWorkspace(nameOrId: string): Workspace {
  const { workspaces } = useWorkspaceStore.getState()
  const found = workspaces.find((w) => w.id === nameOrId || w.name === nameOrId)
  if (found) return found
  const known = workspaces.map((w) => w.name).join(', ') || 'none'
  throw new Error(`No workspace is named ${nameOrId}. The workspaces are: ${known}.`)
}

function requireSession(sessionId: string): void {
  if (!useSessionStore.getState().sessions.has(sessionId))
    throw new Error(`No session has the id ${sessionId}.`)
}

function revealToolSession(sessionId: string): { sessionId: string } {
  requireSession(sessionId)
  revealSession(sessionId)
  return { sessionId }
}

function openInWindow(sessionId: string): { sessionId: string } {
  requireSession(sessionId)
  breakOut(sessionId)
  return { sessionId }
}

async function startWorkTool(args: ToolArgs<'start_work'>): Promise<{ sessionId: string | null }> {
  const { prompt: text, runAs = 'agent', branch } = args
  if (args.workspace === undefined) {
    const sessionId = await startGlobalPrompt({ text, runAs })
    if (sessionId === null) throw new Error(globalStartFailure(text, runAs))
    return { sessionId }
  }
  const workspace = findWorkspace(args.workspace)
  const before = new Set(useSessionStore.getState().sessions.keys())
  const branchPart = branch === undefined ? {} : { branch }
  const request = {
    kind: 'prompt',
    text,
    workspace,
    runAs,
    newWorktree: branch !== undefined,
  } as const
  const failure = await startWork({ ...request, ...branchPart })
  if (failure !== null) throw new Error(failure)
  // shortcut: startWork answers no session id, so the new one is the session that appeared;
  // a tab opened by hand in the same moment could be taken for it. Return the id from startWork if that bites.
  const opened = [...useSessionStore.getState().sessions.keys()].find((id) => !before.has(id))
  return { sessionId: opened ?? null }
}

const folderHolds = (folder: string, cwd: string): boolean =>
  cwd === folder || cwd.startsWith(`${folder}/`)

/** The card whose folder holds `cwd` most closely, in `workspace` when one is named; else Scratch. */
function projectHolding(
  cwd: string,
  workspace?: string
): { projectId: string; workspaceId: string | null } {
  const { workspaces, projectsByWorkspaceId } = useWorkspaceStore.getState()
  const scope = workspace === undefined ? workspaces : [findWorkspace(workspace)]
  const cards = scope.flatMap((w) =>
    (projectsByWorkspaceId.get(w.id) ?? []).map((p) => ({
      p,
      folder: p.worktreePath ?? w.folderPath,
    }))
  )
  const best = cards
    .filter(({ folder }) => folderHolds(folder, cwd))
    .sort((a, b) => b.folder.length - a.folder.length)[0]
  return best
    ? { projectId: best.p.id, workspaceId: best.p.workspaceId }
    : { projectId: SCRATCH_PROJECT_ID, workspaceId: null }
}

/** Opens a terminal tab in `cwd`, runs `command` in it when given, and shows it. Moving a
 * session here opens `claude --resume <id>` through this. */
async function openTerminal(args: ToolArgs<'open_terminal'>): Promise<{ sessionId: string }> {
  const { projectId, workspaceId } = projectHolding(args.cwd, args.workspace)
  const { scrollbackLimit } = useSettingsStore.getState().resolveSettings(workspaceId).terminal
  const opened = { projectId, type: 'human' as const, title: '', cwd: args.cwd, scrollbackLimit }
  const sessionId = await createTerminalSession({ ...opened, initialCommand: args.command }).catch(
    () => {
      throw new Error('The terminal could not be opened.')
    }
  )
  revealSession(sessionId)
  return { sessionId }
}

function describeAction(action: QuickAction) {
  const { id, label, group, description, disabledReason } = action
  return { id, label, group, description, disabledReason, destructive: action.destructive === true }
}

interface Mark {
  label: string
  destructive: boolean
}

/** Refuses a target whose mark differs from the tool's, naming the tool that fits it:
 * `run_<kind>` or `run_destructive_<kind>`. */
function checkMark(
  target: Mark,
  viaDestructive: boolean,
  kind: 'quick_action' | 'extension_command'
): void {
  if (target.destructive && !viaDestructive)
    throw new Error(
      `${target.label} closes or deletes something. Run it with run_destructive_${kind}.`
    )
  if (!target.destructive && viaDestructive)
    throw new Error(`${target.label} does not close or delete anything. Run it with run_${kind}.`)
}

async function runQuickAction(actions: QuickAction[], id: string, viaDestructive: boolean) {
  const action = actions.find((a) => a.id === id)
  if (!action) throw new Error(`No quick action has the id ${id}. list_quick_actions lists them.`)
  const mark = { label: action.label, destructive: action.destructive === true }
  checkMark(mark, viaDestructive, 'quick_action')
  if (action.disabledReason)
    throw new Error(`${action.label} cannot run now: ${action.disabledReason}.`)
  await action.run()
  return { ran: id }
}

async function runExtensionCommand(
  args: ToolArgs<'run_extension_command'>,
  viaDestructive: boolean
) {
  const { command } = args
  const { extension } = window.electronAPI
  if (!(await extension.hasCommand(command)))
    throw new Error(
      `No running extension has the command ${command}. list_extension_commands lists them.`
    )
  // shortcut: a command that takes args is in no list, so its mark reads as not destructive;
  // check `destructive` in main's registry instead once such a command deletes anything.
  const listed = (await extension.getCommands()).commands.find((c) => c.key === command)
  const mark = { label: listed?.label ?? command, destructive: listed?.destructive === true }
  checkMark(mark, viaDestructive, 'extension_command')
  extension.executeCommand(command, { projectId: null, sessionId: null, repoRoot: null }, args.args)
  return { ran: command }
}
