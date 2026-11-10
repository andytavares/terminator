import * as path from 'node:path'
import { z } from 'zod'
import { publishAsks, setActionHandler } from '../home/home-feed.js'
import {
  AlertSchema,
  alertActionId,
  createAlerts,
  type Alert,
  type AlertAction,
} from '../home/scheduled-alerts.js'
import { revealSessionOnClick } from '../ipc/notification.ipc.js'
import { notificationManager } from '../notifications/notification-manager.js'
import { openExternally } from '../open-externally.js'
import { toolMarks, type McpToolDef, type ToolProvider } from './tool-types.js'

// The `alert` tool: any Claude Code session shows something on Home or sends a notification.

const SOURCE = 'claude-alerts'

let alerts: ReturnType<typeof createAlerts> | null = null

function pressButton(action: AlertAction, terminalId: string | null, dismiss: () => void): void {
  if (action.reply && terminalId) revealSessionOnClick(terminalId)
  if (action.url) openExternally(action.url)
  if (action.dismiss) dismiss()
}

/** The same buttons as on Home: the alert's own, then Dismiss. */
function notificationButtons(alert: Alert, terminalId: string | null, dismiss: () => void) {
  const buttons = alert.actions.map((action, index) => ({
    id: alertActionId(action, index),
    label: action.label,
    handler: () => pressButton(action, terminalId, dismiss),
  }))
  return [...buttons, { id: 'dismiss', label: 'Dismiss', handler: dismiss }]
}

function clickNotification(alert: Alert, terminalId: string | null): (() => void) | undefined {
  const { url } = alert
  if (url) return () => openExternally(url)
  if (terminalId) return () => revealSessionOnClick(terminalId)
  return undefined
}

/** Created on the first alert; Dismiss is wired with it. */
function homeAlerts(): ReturnType<typeof createAlerts> {
  if (alerts) return alerts
  const created = createAlerts({
    now: () => new Date(),
    notify: (alert, { terminalId, dismiss }) =>
      notificationManager.create({
        type: 'info',
        title: alert.title,
        message: alert.message,
        key: 'claudeAlert',
        actions: notificationButtons(alert, terminalId, dismiss),
        onClick: clickNotification(alert, terminalId),
      }),
    unnotify: (notificationId) => notificationManager.withdraw(notificationId),
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
    'An alert with the same title and source within a day replaces the earlier one. ' +
    '`url` is an http(s) link opened when the person clicks the alert. ' +
    '`actions` adds up to three buttons: `url` opens a link, `dismiss: true` removes the alert ' +
    'after the press, and `reply: true` lets the person answer you (one Reply at most; only from ' +
    'a session in a Terminator terminal).',
  inputSchema: z.toJSONSchema(AlertSchema, { io: 'input' }) as Record<string, unknown>,
  ...toolMarks({ destructive: false, readOnly: false }),
  call: async (args, caller) => {
    homeAlerts().receive(args, `Claude · ${path.basename(caller.projectDir)}`, caller.terminalId)
    return { sent: true }
  },
}

export const alertTool: ToolProvider = { tools: () => [alert] }
