import { shell } from 'electron'
import { homedir } from 'os'
import { z } from 'zod'
import { registerInvokeTable, invokeSpec } from './invoke-table.js'
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

const invalid = { error: 'VALIDATION_ERROR' }

export function registerShellHandlers(): void {
  registerInvokeTable([
    invokeSpec({
      channel: 'shell:open-path',
      schema: z.object({ filePath: z.string().min(1) }),
      invalid,
      run: async ({ filePath }) => {
        const errorMsg = await shell.openPath(filePath.replace(/^~(?=\/|$)/, homedir()))
        return errorMsg ? { error: errorMsg } : { ok: true as const }
      },
    }),
    invokeSpec({
      channel: 'shell:open-external',
      schema: z.object({ url: z.string().url() }),
      invalid,
      run: async ({ url }) => {
        await shell.openExternal(url)
        return { ok: true as const }
      },
      onError: (err) => ({ error: String(err) }),
    }),
    invokeSpec({
      channel: 'shell:exec',
      schema: ShellExecPayloadSchema,
      invalid: (error: z.ZodError) => ({ error: 'VALIDATION_ERROR', message: error.message }),
      run: async ({ command, args, cwd, timeoutMs = 10000, workspaceRoot }) => {
        assertCommandAllowed(command)
        if (workspaceRoot) assertCwdInScope(cwd, workspaceRoot)
        return await execShell({ command, args, cwd, timeoutMs })
      },
      onError: (err) => {
        if (err instanceof CommandNotAllowedError) return { error: 'COMMAND_NOT_ALLOWED' }
        if (err instanceof CwdOutOfScopeError) return { error: 'CWD_OUT_OF_SCOPE' }
        return { error: String(err) }
      },
    }),
  ])
}
