import { registerInvokeTable, invokeSpec, noPayload } from './invoke-table.js'
import { healthCheck } from '../db/index.js'

export function registerDbIpcHandlers(): void {
  registerInvokeTable([
    invokeSpec({
      channel: 'db:health',
      schema: noPayload,
      invalid: { ok: false, message: 'VALIDATION_ERROR' },
      run: () => healthCheck(),
      onError: (err) => ({ ok: false, message: String(err) }),
    }),
  ])
}
