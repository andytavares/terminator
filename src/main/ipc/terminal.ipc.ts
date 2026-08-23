import { handleChannel, onChannel } from './channel-registrar.js'
import { getLink } from '../integrations/issue-link-store.js'
import { readContextFile } from '../integrations/agent-context.js'
import { notificationManager } from '../notifications/notification-manager.js'
import { sendToWindow } from '../safe-send.js'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { homedir } from 'os'
import type { PtyManager } from '../terminal/pty-manager.js'
import type { BrowserWindow } from 'electron'
import { getGlobalSettings } from '../storage/settings-store.js'

const CreateTerminalSchema = z.object({
  projectId: z.string().uuid(),
  type: z.enum(['human', 'agent']),
  tabTitle: z.string().min(1).max(100),
  scrollbackLimit: z.number().int().min(1000).max(100000).optional(),
  cwd: z.string().min(1),
  shell: z.string().optional(),
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

// PtyManager owns session state (see ADR-024); this layer only translates IPC
// payloads and relays output/exit pushes to the renderer window.
export function registerTerminalHandlers(
  ptyManager: PtyManager,
  getWindow: () => BrowserWindow | null
): void {
  handleChannel('terminal:create', (_event, payload) => {
    const parsed = CreateTerminalSchema.safeParse(payload)
    if (!parsed.success) {
      return { error: 'VALIDATION_ERROR', message: parsed.error.message }
    }

    const { projectId, tabTitle, type, cwd, shell } = parsed.data
    const globalSettings = getGlobalSettings()
    const defaultShell = shell ?? globalSettings.terminal.defaultShell
    const sessionId = randomUUID()
    const resolvedCwd = cwd === '~' ? homedir() : cwd

    ptyManager.spawnSession({
      sessionId,
      cwd: resolvedCwd,
      shell: defaultShell,
      type,
      origin: 'app',
      projectId,
      tabTitle,
      env: issueEnvFor(projectId),
    })
    ptyManager.onData(sessionId, (data) => {
      const win = getWindow()
      if (win && !win.isDestroyed()) win.webContents.send('terminal:output', { sessionId, data })
    })
    ptyManager.onExit(sessionId, (exitCode) => {
      const win = getWindow()
      if (win && !win.isDestroyed())
        win.webContents.send('terminal:process-exit', { sessionId, exitCode })
    })

    void announceIssueContext(projectId, sessionId, getWindow)

    return { sessionId }
  })

  handleChannel('terminal:list-sessions', () => {
    // Only sessions created through terminal:create carry project metadata;
    // legacy api.pty.spawn sessions are 'app'-origin too but have no tab in
    // the renderer, matching the pre-authority registry's contents.
    return ptyManager
      .listSessions()
      .filter((s) => s.origin === 'app' && s.projectId !== undefined)
      .map(({ sessionId, projectId, tabTitle, type }) => ({ sessionId, projectId, tabTitle, type }))
  })

  handleChannel('terminal:attach', (_event, payload) => {
    const parsed = z.object({ sessionId: z.string() }).safeParse(payload)
    if (!parsed.success) return { released: false }
    // A terminal is on screen and ready to be written to. Anything the process
    // printed before now was held back rather than dropped.
    return { released: ptyManager.releaseOutput(parsed.data.sessionId) }
  })

  handleChannel('terminal:close', (_event, { sessionId }) => {
    ptyManager.kill(sessionId)
    return { success: true }
  })

  onChannel('terminal:input', (_event, payload) => {
    const parsed = TerminalInputSchema.safeParse(payload)
    if (parsed.success) {
      ptyManager.write(parsed.data.sessionId, parsed.data.data)
    }
  })

  onChannel('terminal:resize', (_event, payload) => {
    const parsed = TerminalResizeSchema.safeParse(payload)
    if (parsed.success) {
      ptyManager.resize(parsed.data.sessionId, parsed.data.cols, parsed.data.rows)
    }
  })

  handleChannel('terminal:close-all', async () => {
    const count = ptyManager.getSessionIds().length
    await ptyManager.killAll()
    return { terminatedCount: count }
  })

  handleChannel('terminal:cleanup-orphans', () => {
    return ptyManager.cleanupOrphans()
  })
}
