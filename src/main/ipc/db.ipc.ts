import { handleChannel } from './channel-registrar.js'
import { healthCheck } from '../db/index.js'

export function registerDbIpcHandlers(): void {
  handleChannel('db:health', async () => {
    try {
      return await healthCheck()
    } catch (err) {
      return { ok: false, message: String(err) }
    }
  })
}
