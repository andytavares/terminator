// Notification discipline (FR-023, FR-028). Automation complacency is the
// documented failure mode of supervisory control: a console that only speaks up
// when something is wrong teaches the operator that silence means fine, and
// silence is exactly what a crashed console also looks like.
//
// So: modal for a blocking permission request only, non-blocking indication for
// anything else that needs a person, and routine progress batched into a
// digest rather than interrupting at all.

export type NotificationChannel = 'modal' | 'indicator' | 'digest'

export interface NotifiableEvent {
  readonly kind: 'permission_requested' | 'stalled' | 'failed' | 'ready' | 'progress'
  readonly sessionId: string
}

export function channelFor(event: NotifiableEvent): NotificationChannel {
  switch (event.kind) {
    case 'permission_requested':
      // The only thing that may interrupt: an agent is stopped dead until it
      // is answered.
      return 'modal'
    case 'stalled':
    case 'failed':
    case 'ready':
      return 'indicator'
    case 'progress':
      return 'digest'
  }
}
