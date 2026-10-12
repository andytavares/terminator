import type { ExtensionAPI, ExtensionDB } from '@terminator/extension-sdk'
import { registerRoutes } from './register'
import { CAPTURE_ROUTES } from './vault-capture'
import { DAILY_ROUTES } from './vault-daily'
import { TASK_STATE_ROUTES } from './vault-task-state'
import { INBOX_ROUTES } from './vault-inbox'
import { AREA_ROUTES } from './vault-areas'
import { QUERY_ROUTES } from './vault-queries'
import { TRANSFER_ROUTES } from './vault-transfer'
import { RECURRENCE_ROUTES } from './vault-recurrence'

/** Every task-vault:vault:* channel, plus the project-tasks and stale-threshold ones. */
const VAULT_ROUTES = [
  ...CAPTURE_ROUTES,
  ...DAILY_ROUTES,
  ...TASK_STATE_ROUTES,
  ...INBOX_ROUTES,
  ...AREA_ROUTES,
  ...QUERY_ROUTES,
  ...TRANSFER_ROUTES,
  ...RECURRENCE_ROUTES,
]

export function registerVaultIpcHandlers(api: ExtensionAPI, db: ExtensionDB): () => void {
  return registerRoutes({ api, db }, VAULT_ROUTES)
}
