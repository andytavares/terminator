import type { ExtensionAPI, Disposable } from '@terminator/extension-sdk'
import * as path from 'node:path'

import type { PendingAsk } from './pending-permissions.js'
import { channelFor, type NotifiableEvent } from './feed/notification-channel.js'

import { announceLive, orderStoreAt } from '../state/live-index.js'
import { runtime, pendingPermissions, raisedNotifications } from './runtime-state.js'
import { gotoRun } from './palette-commands.js'

/**
 * Says something, through the channel the event's kind is allowed.
 *
 * Automation complacency is the documented failure mode of supervisory control:
 * a console that only speaks when something is wrong teaches you that silence
 * means fine — and silence is also what a crashed console looks like. So the
 * rule is fixed rather than per-call: only a blocking permission request may
 * interrupt, everything else that needs a person is an indication, and routine
 * progress goes to the feed and nowhere else.
 */
export function notify(
  api: ExtensionAPI,
  event: NotifiableEvent,
  message: string,
  actions?: Array<{ id: string; label: string; handler: () => void }>,
  /** Where the row takes you. Without one it is a report, not a link. */
  onClick?: () => void
): Disposable | null {
  switch (channelFor(event)) {
    case 'modal':
      // The nearest thing an extension has to a modal: it persists until it is
      // answered, and it carries the answer with it.
      return api.notifications.createNotification({
        type: 'warning',
        title: message,
        key: `foundry.permission.${event.sessionId}`,
        actions,
        onClick,
      })
    case 'indicator':
      api.notifications.showToast('warning', message, `foundry.${event.kind}.${event.sessionId}`)
      return null
  }
}

/**
 * A tool call is being held, and somebody has to see it.
 *
 * The one thing allowed to interrupt: the run is stopped dead until it is
 * answered, and a request nobody sees is a twelve-hour hang. This used to live
 * inside a sink that nothing called, so every held call was silent.
 */
export function notePending(api: ExtensionAPI, ask: PendingAsk, order?: OrderRef): void {
  pendingPermissions.add(ask)
  announceLive('')

  // A question asked *during execution* is a defect of intake (FR-083): the
  // Forge is where questions are supposed to be settled, and one arriving now
  // means the order was handed off with something unanswered in it. Recorded
  // against the order as well as answered — answering it alone loses the fact
  // that it should never have been asked here.
  if (order !== undefined && (ask.questions?.length ?? 0) > 0) {
    void orderStoreAt(order.root).record({
      at: new Date().toISOString(),
      orderId: order.id,
      actor: 'rule:forge-defect',
      action: 'intake.defect',
      subject: ask.sessionId,
      reason: `asked during execution, which intake should have settled: ${ask.questions
        ?.map((q) => q.question)
        .join('; ')}`,
      evidence: [{ kind: 'stdout', excerpt: ask.summary }],
    })
  }
  const notification = notify(
    api,
    { kind: 'permission_requested', sessionId: ask.sessionId },
    `${path.basename(ask.featureDir)} is asking: ${ask.summary}`,
    [
      {
        id: 'allow',
        label: 'Allow',
        handler: () =>
          runtime.supervisedRunner?.resolve(ask.sessionId, ask.requestId, { allow: true }),
      },
      {
        id: 'deny',
        label: 'Deny',
        handler: () =>
          runtime.supervisedRunner?.resolve(ask.sessionId, ask.requestId, { allow: false }),
      },
    ],
    // Opening the thing is not a third answer to the question; it is what
    // clicking the notification should do.
    () => gotoRun(api, 'run', ask.sessionId)
  )
  if (notification !== null) raisedNotifications.set(ask.requestId, notification)
}

/** Which order a held tool call belongs to, so a question can be recorded. */
interface OrderRef {
  readonly id: string
  readonly root: string
}

/** Answered, by whoever. The notification goes with the request. */
export function noteResolved(requestId: string): void {
  pendingPermissions.remove(requestId)
  announceLive('')
  // A notification left behind after the thing it was about is answered
  // teaches you to dismiss without reading.
  raisedNotifications.get(requestId)?.dispose()
  raisedNotifications.delete(requestId)
}
