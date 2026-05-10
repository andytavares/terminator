import { ipcMain, shell } from 'electron'
import { z } from 'zod'
import {
  execShell,
  assertCommandAllowed,
  assertCwdInScope,
  CommandNotAllowedError,
  CwdOutOfScopeError,
} from '../shell/shell-executor.js'

const ShellExecPayloadSchema = z.object({
  command: z.enum(['git', 'gh']),
  args: z.array(z.string()),
  cwd: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
  workspaceRoot: z.string().optional(),
})

export function registerShellHandlers(): void {
  ipcMain.handle('shell:open-path', async (_event, payload) => {
    const parsed = z.object({ filePath: z.string().min(1) }).safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    const errorMsg = await shell.openPath(parsed.data.filePath)
    return errorMsg ? { error: errorMsg } : { ok: true as const }
  })

  ipcMain.handle('shell:exec', async (_event, payload) => {
    const parsed = ShellExecPayloadSchema.safeParse(payload)
    if (!parsed.success) {
      return { error: 'VALIDATION_ERROR', message: parsed.error.message }
    }

    const { command, args, cwd, timeoutMs = 10000, workspaceRoot } = parsed.data

    try {
      assertCommandAllowed(command)
      if (workspaceRoot) assertCwdInScope(cwd, workspaceRoot)
      return await execShell({ command, args, cwd, timeoutMs })
    } catch (err) {
      if (err instanceof CommandNotAllowedError) return { error: 'COMMAND_NOT_ALLOWED' }
      if (err instanceof CwdOutOfScopeError) return { error: 'CWD_OUT_OF_SCOPE' }
      return { error: String(err) }
    }
  })
}
