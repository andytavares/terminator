import { onChannel } from './channel-registrar.js'
import { defineChannel, type ChannelSpec, validationError } from '@terminator/extension-sdk'
import { registerInvokeTable, noPayload } from './invoke-table.js'
import { getLink } from '../integrations/issue-link-store.js'
import { readContextFile } from '../integrations/agent-context.js'
import { notificationManager } from '../notifications/notification-manager.js'
import { sendToWindow } from '../safe-send.js'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { homedir } from 'os'
import { MissingCwdError } from '../terminal/pty-manager.js'
import type { OutputRelay, RendererSend } from '../terminal/output-relay.js'
import type { PtyManager } from '../terminal/pty-manager.js'
import type { BrowserWindow } from 'electron'
import { defaultShellFor } from '../terminal/default-shell.js'
import { markClosed } from '../sessions/session-record-store.js'
import { clearAskOnInput } from '../agents/ask-watcher.js'

const CreateTerminalSchema = z.object({
  projectId: z.string().uuid(),
  type: z.enum(['human', 'agent']),
  tabTitle: z.string().min(1).max(100),
  scrollbackLimit: z.number().int().min(1000).max(100000).optional(),
  cwd: z.string().min(1),
  shell: z.string().optional(),
  /**
   * One line to run in the terminal once it is open, for a terminal opened to
   * carry on an agent conversation. One line, so nothing can be smuggled in
   * behind the command that was asked for.
   */
  initialCommand: z
    .string()
    .min(1)
    .refine((value) => !/[\r\n]/.test(value), { message: 'An initial command is one line' })
    .optional(),
})

const TerminalInputSchema = z.object({
  sessionId: z.string(),
  data: z.string(),
})

const TerminalResizeSchema = z.object({
  sessionId: z.string(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
})

const TerminalAcknowledgeSchema = z.object({
  sessionId: z.string(),
  count: z.number().int().nonnegative(),
})

/**
 * The linked issue, for scripts and prompts inside the project's terminals.
 *
 * Convenience, not mechanism: an agent gets its context from the SessionStart
 * hook, which also covers a `claude` the operator starts by hand elsewhere.
 */
function issueEnvFor(projectId: string | undefined): Record<string, string> | undefined {
  if (projectId === undefined) return undefined
  const link = getLink(projectId)
  if (link === null) return undefined
  return { TERMINATOR_ISSUE_KEY: link.key, TERMINATOR_ISSUE_TRACKER: link.tracker }
}

/**
 * Tell the operator a session started knowing about an issue (FR-024).
 *
 * Through the notification system under its own key, so it can be turned down
 * to centre-only or off like anything else — a notice on every terminal in a
 * linked project would otherwise become noise nobody reads.
 */
async function announceIssueContext(
  projectId: string | undefined,
  sessionId: string,
  getWindow: () => BrowserWindow | null
): Promise<void> {
  if (projectId === undefined) return
  const link = getLink(projectId)
  if (link === null || !link.injectContext) return

  const context = await readContextFile(projectId)
  if (context === null) return

  sendToWindow(getWindow(), 'integrations:context-injected', {
    projectId,
    sessionId,
    tracker: context.tracker,
    key: context.key,
    chars: context.chars,
    truncated: context.truncated,
  })

  notificationManager.create({
    type: 'info',
    title: `Session started with ${context.key}`,
    message: `${context.chars.toLocaleString()} characters of issue context${
      context.truncated ? ' (shortened)' : ''
    }`,
    key: 'issueContextInjected',
    source: 'core',
  })
}

const announcements = new Set<Promise<void>>()

function announceInBackground(
  projectId: string | undefined,
  sessionId: string,
  getWindow: () => BrowserWindow | null
): void {
  const announcement = announceIssueContext(projectId, sessionId, getWindow).finally(() =>
    announcements.delete(announcement)
  )
  announcements.add(announcement)
}

/** Settles when every issue-context notice a created terminal started has been sent, or has been
 * found to have nothing to send. */
export async function issueContextAnnounced(): Promise<void> {
  await Promise.all(announcements)
}

interface TerminalContext {
  ptyManager: PtyManager
  getWindow: () => BrowserWindow | null
  relay: OutputRelay
}

const sessionIdPayload = z.object({ sessionId: z.string() })

function createChannel(context: TerminalContext): ChannelSpec {
  return defineChannel({
    channel: 'terminal:create',
    schema: CreateTerminalSchema,
    invalid: validationError,
    run: (input) => createPtySession(context, input),
    // Reported rather than thrown, so the renderer can say which folder is
    // gone. A branch whose worktree was deleted outside the app otherwise
    // produced a tab that died instantly with nothing written in it.
    onError: (err) => {
      if (err instanceof MissingCwdError) return { error: 'CWD_MISSING', message: err.message }
      throw err
    },
  })
}

function listSessionsChannel(ptyManager: PtyManager): ChannelSpec {
  return defineChannel({
    channel: 'terminal:list-sessions',
    schema: noPayload,
    invalid: [],
    run: () =>
      // Only sessions created through terminal:create carry project metadata;
      // legacy api.pty.spawn sessions are 'app'-origin too but have no tab in
      // the renderer, matching the pre-authority registry's contents.
      ptyManager
        .listSessions()
        .filter((s) => s.origin === 'app' && s.projectId !== undefined)
        .map(({ sessionId, projectId, tabTitle, type }) => ({
          sessionId,
          projectId,
          tabTitle,
          type,
        })),
  })
}

function attachChannel({ ptyManager, relay }: TerminalContext): ChannelSpec {
  return defineChannel({
    channel: 'terminal:attach',
    schema: sessionIdPayload,
    invalid: { released: false },
    // A terminal is on screen and ready to be written to. Anything the process
    // printed before now was held back rather than dropped.
    run: ({ sessionId }) => {
      // A renderer attaching owes nothing for output an earlier one was sent.
      relay.rendererAttached(sessionId)
      return { released: ptyManager.releaseOutput(sessionId) }
    },
  })
}

function closeChannels(ptyManager: PtyManager): ChannelSpec[] {
  return [
    defineChannel({
      channel: 'terminal:close',
      schema: sessionIdPayload,
      invalid: { error: 'VALIDATION_ERROR' },
      run: ({ sessionId }) => {
        ptyManager.kill(sessionId)
        void markClosed(sessionId, new Date())
        return { success: true }
      },
    }),
    defineChannel({
      channel: 'terminal:close-all',
      schema: noPayload,
      invalid: { error: 'VALIDATION_ERROR' },
      run: async () => {
        const count = ptyManager.getSessionIds().length
        await ptyManager.killAll()
        return { terminatedCount: count }
      },
    }),
    defineChannel({
      channel: 'terminal:cleanup-orphans',
      schema: noPayload,
      invalid: { error: 'VALIDATION_ERROR' },
      run: () => ptyManager.cleanupOrphans(),
    }),
  ]
}

/** Keystrokes, flow-control acknowledgements and resizes: sent, never answered. */
function registerStreamHandlers({ ptyManager, relay }: TerminalContext): void {
  onChannel('terminal:input', (_event, payload) => {
    const parsed = TerminalInputSchema.safeParse(payload)
    if (parsed.success) {
      ptyManager.write(parsed.data.sessionId, parsed.data.data)
      clearAskOnInput(parsed.data.sessionId, parsed.data.data)
    }
  })

  onChannel('terminal:acknowledge', (_event, payload) => {
    const parsed = TerminalAcknowledgeSchema.safeParse(payload)
    if (parsed.success) relay.acknowledgeOutput(parsed.data.sessionId, parsed.data.count)
  })

  onChannel('terminal:resize', (_event, payload) => {
    const parsed = TerminalResizeSchema.safeParse(payload)
    if (parsed.success) {
      ptyManager.resize(parsed.data.sessionId, parsed.data.cols, parsed.data.rows)
    }
  })
}

// PtyManager owns session state (see ADR-024); this layer only translates IPC
// payloads and relays output/exit pushes to the renderer window.
export function registerTerminalHandlers(
  ptyManager: PtyManager,
  getWindow: () => BrowserWindow | null,
  relay: OutputRelay
): void {
  const context: TerminalContext = { ptyManager, getWindow, relay }
  registerInvokeTable([
    createChannel(context),
    listSessionsChannel(ptyManager),
    attachChannel(context),
    ...closeChannels(ptyManager),
  ])
  registerStreamHandlers(context)
}

function createPtySession(
  { ptyManager, getWindow, relay }: TerminalContext,
  input: z.infer<typeof CreateTerminalSchema>
): { sessionId: string; shell: string } {
  const { projectId, tabTitle, type, cwd, shell, initialCommand } = input
  const defaultShell = shell ?? defaultShellFor(projectId)
  const sessionId = randomUUID()

  ptyManager.spawnSession({
    sessionId,
    cwd: cwd === '~' ? homedir() : cwd,
    shell: defaultShell,
    type,
    origin: 'app',
    projectId,
    tabTitle,
    // The terminal names itself, so an agent started in it — by this
    // application or by hand — can be placed against this session (ADR 055).
    env: { ...issueEnvFor(projectId), TERMINATOR_SESSION_ID: sessionId },
  })
  relay.startRelaying(sessionId)
  announceInBackground(projectId, sessionId, getWindow)

  // Written straight in: the line discipline holds it until the shell reads
  // it, and a resume command is far inside the 1024-byte canonical limit that
  // mangled a long launch line before.
  if (initialCommand !== undefined) ptyManager.write(sessionId, `${initialCommand}\n`)

  return { sessionId, shell: defaultShell }
}

/** Sends to the window if there is a live one, and says whether it did. */
export function sendToRenderer(getWindow: () => BrowserWindow | null): RendererSend {
  return (channel, payload) => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return false
    win.webContents.send(channel, payload)
    return true
  }
}
