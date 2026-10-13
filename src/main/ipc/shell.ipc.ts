import { shell } from 'electron'
import { homedir } from 'os'
import { z } from 'zod'
import { defineChannel } from '@terminator/extension-sdk'
import { validationError } from './validation-error.js'
import { registerInvokeTable } from './invoke-table.js'
import {
  execShell,
  assertCwdInScope,
  ALLOWED_COMMAND_NAMES,
  CwdOutOfScopeError,
} from '../shell/shell-executor.js'

// The allowlist is the schema: a command outside it is a validation error
// before anything runs.
const ShellExecPayloadSchema = z.object({
  command: z.enum(ALLOWED_COMMAND_NAMES),
  args: z.array(z.string()),
  cwd: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
  workspaceRoot: z.string().optional(),
})

const invalid = { error: 'VALIDATION_ERROR' }

const openPathChannel = defineChannel({
  channel: 'shell:open-path',
  schema: z.object({ filePath: z.string().min(1) }),
  invalid,
  run: async ({ filePath }) => {
    const errorMsg = await shell.openPath(filePath.replace(/^~(?=\/|$)/, homedir()))
    return errorMsg ? { error: errorMsg } : { ok: true as const }
  },
})

const openExternalChannel = defineChannel({
  channel: 'shell:open-external',
  schema: z.object({ url: z.string().url() }),
  invalid,
  run: async ({ url }) => {
    await shell.openExternal(url)
    return { ok: true as const }
  },
  onError: (err) => ({ error: String(err) }),
})

const execChannel = defineChannel({
  channel: 'shell:exec',
  schema: ShellExecPayloadSchema,
  invalid: validationError,
  run: async ({ command, args, cwd, timeoutMs = 10000, workspaceRoot }) => {
    if (workspaceRoot) await assertCwdInScope(cwd, [workspaceRoot])
    return await execShell({ command, args, cwd, timeoutMs })
  },
  onError: (err) => {
    if (err instanceof CwdOutOfScopeError) return { error: 'CWD_OUT_OF_SCOPE' }
    return { error: String(err) }
  },
})

export function registerShellHandlers(): void {
  registerInvokeTable([openPathChannel, openExternalChannel, execChannel])
}
