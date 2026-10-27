import type { ExtensionAPI, Disposable } from '@terminator/extension-sdk'
import * as path from 'node:path'

import type { PendingAsk } from './pending-permissions.js'
import { channelFor, type NotifiableEvent } from './feed/notification-channel.js'

import { announceLive } from '../state/live-index.js'
import { runtime, pendingPermissions, raisedNotifications } from './runtime-state.js'
import { gotoRun } from './palette-commands.js'

/** Something to say, about which event, and what answering or clicking it does. */
export interface Notice {
  readonly event: NotifiableEvent
  readonly message: string
  readonly actions?: Array<{ id: string; label: string; handler: () => void }>
  /** Where the row takes you. Without one it is a report, not a link. */
  readonly onClick?: () => void
}

// Says something through the channel its kind is allowed, fixed, not per call: only a
// blocking permission request interrupts, anything else needing a person is an
// indication, and progress goes to the feed. A console that only speaks up teaches silence.
export function notifyPerson(api: ExtensionAPI, notice: Notice): Disposable | null {
  const { event, message, actions, onClick } = notice
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

// A tool call is held and somebody must see it: the one thing allowed to interrupt,
// since the run is stopped dead until it is answered.
export function notePending(api: ExtensionAPI, ask: PendingAsk): void {
  pendingPermissions.add(ask)
  announceLive('')

  const notification = notifyPerson(api, {
    event: { kind: 'permission_requested', sessionId: ask.sessionId },
    message: `${path.basename(ask.featureDir)} is asking: ${ask.summary}`,
    actions: [answerAction(ask, true), answerAction(ask, false)],
    // Opening the thing is not a third answer to the question; it is what
    // clicking the notification should do.
    onClick: () => gotoRun(api, 'run', ask.sessionId),
  })
  if (notification !== null) raisedNotifications.set(ask.requestId, notification)
}

function answerAction(
  ask: PendingAsk,
  allow: boolean
): { id: string; label: string; handler: () => void } {
  return {
    id: allow ? 'allow' : 'deny',
    label: allow ? 'Allow' : 'Deny',
    handler: () => runtime.supervisedRunner?.resolve(ask.sessionId, ask.requestId, { allow }),
  }
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
