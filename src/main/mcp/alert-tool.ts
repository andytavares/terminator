import * as path from 'node:path'
import { z } from 'zod'
import { publishAsks, setActionHandler } from '../home/home-feed.js'
import { AlertSchema, createAlerts } from '../home/scheduled-alerts.js'
import { notificationManager } from '../notifications/notification-manager.js'
import { toolMarks, type McpToolDef, type ToolProvider } from './tool-types.js'

// The `alert` tool: any Claude Code session shows something on Home or sends a notification.

const SOURCE = 'claude-alerts'

let alerts: ReturnType<typeof createAlerts> | null = null

/** Created on the first alert; Dismiss is wired with it. */
function homeAlerts(): ReturnType<typeof createAlerts> {
  if (alerts) return alerts
  const created = createAlerts({
    now: () => new Date(),
    notify: (title, message) =>
      void notificationManager.create({ type: 'info', title, message, key: 'claudeAlert' }),
    publish: (asks) => publishAsks(SOURCE, asks),
  })
  setActionHandler(SOURCE, async (askId, actionId) => created.act(askId, actionId))
  alerts = created
  return created
}

const alert: McpToolDef = {
  name: 'alert',
  description:
    'Shows an alert to the person on Terminator Home (with Dismiss) and as a notification. ' +
    'An alert with the same title and source within a day replaces the earlier one.',
  inputSchema: z.toJSONSchema(AlertSchema, { io: 'input' }) as Record<string, unknown>,
  ...toolMarks({ destructive: false, readOnly: false }),
  call: async (args, caller) => {
    homeAlerts().receive(args, `Claude · ${path.basename(caller.projectDir)}`)
    return { sent: true }
  },
}

export const alertTool: ToolProvider = { tools: () => [alert] }
