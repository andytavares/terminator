import { defineChannel, noPayload } from '@terminator/extension-sdk'
import type { ExtensionAPI } from '@terminator/extension-sdk'
import type { z } from 'zod'

import { foundryChannel, sessionChannel } from './channel.js'
import {
  FeedDismissPayload,
  FeedMutePayload,
  PermissionHandBackPayload,
  PermissionResolvePayload,
  RedirectPayload,
  SessionPayload,
  SessionStopPayload,
  TranscriptPayload,
} from './payloads.js'
import { readTranscriptTail } from '../runtime/transcript-excerpt.js'

import { reg } from './register.js'
import { announceLive } from '../state/live-index.js'
import { stallShadowMode } from '../state/settings.js'
import { runtime, pendingPermissions, stallFirings } from '../runtime/runtime-state.js'

/**
 * What the console needs from the supervision runtime: what is held, what
 * stalled, the feed, answering a held call, and the actions on one run.
 */
export function registerSupervisionChannels(api: ExtensionAPI): void {
  registerFeedChannels(api)
  registerPermissionAnswers(api)
  registerRunActions(api)
}

function registerFeedChannels(api: ExtensionAPI): void {
  // What a supervised run is waiting on, and how the operator answers it.
  // Without these a phase blocks at its PreToolUse hook until the bridge hands
  // the decision back to the terminal — which works, but makes the console a
  // spectator of its own agents.
  reg(
    api,
    foundryChannel('foundry:permissions-list', noPayload, () => ({
      pending: pendingPermissions.list(),
    })),
    // The firings, and whether they were recorded or surfaced. Precision is
    // measured against these by hand before shadow mode is turned off.
    foundryChannel('foundry:stalls-list', noPayload, () => ({
      firings: stallFirings,
      shadowMode: stallShadowMode(api),
    })),
    foundryChannel('foundry:feed-list', noPayload, () => ({
      entries: runtime.supervision?.feed.list() ?? [],
      mutes: runtime.mutes?.list() ?? [],
    })),
    // Anything shown as a list should be prunable, and a feed you cannot clear a
    // line from is one you stop reading.
    foundryChannel('foundry:feed-dismiss', FeedDismissPayload, ({ id }) => {
      runtime.supervision?.feed.removeEntry(id)
      return { ok: true }
    }),
    foundryChannel('foundry:feed-mute', FeedMutePayload, (rule) => {
      runtime.mutes?.add(rule)
      announceLive('')
      return { mutes: runtime.mutes?.list() ?? [] }
    }),
    foundryChannel('foundry:feed-unmute', FeedMutePayload, (rule) => {
      runtime.mutes?.remove(rule)
      announceLive('')
      return { mutes: runtime.mutes?.list() ?? [] }
    })
  )
}

function registerPermissionAnswers(api: ExtensionAPI): void {
  reg(
    api,
    defineChannel({
      channel: 'foundry:permission-resolve',
      schema: PermissionResolvePayload,
      invalid: { ok: false, reason: 'Malformed request.' },
      run: resolvePermission,
    }),
    // Hands one back deliberately: the operator would rather answer it in the
    // terminal, where they can see what the agent was doing around it.
    sessionChannel('foundry:permission-hand-back', PermissionHandBackPayload, ({ requestId }) => {
      const sessionId = pendingPermissions.sessionFor(requestId)
      if (sessionId === null || runtime.supervisedRunner === null) return { ok: false }
      runtime.supervisedRunner.handBackToTerminal(sessionId, requestId)
      return { ok: true }
    })
  )
}

function resolvePermission({
  requestId,
  decision,
  answer,
}: z.infer<typeof PermissionResolvePayload>): { ok: true } | { ok: false; reason: string } {
  const sessionId = pendingPermissions.sessionFor(requestId)
  if (sessionId === null || runtime.supervisedRunner === null) {
    // Already answered, already handed back, or the run has ended. Reported
    // rather than swallowed: a click that does nothing is worse than a
    // refusal that says why.
    return { ok: false, reason: 'that request is no longer waiting' }
  }
  const answered = runtime.supervisedRunner.resolve(sessionId, requestId, {
    allow: decision === 'allow',
    answer: answer === undefined || answer.trim() === '' ? undefined : answer,
  })
  if (!answered) {
    // The id was still on the board but the bridge had let it go — answered
    // in the terminal, handed back, or the run ended. Saying "ok" left a card
    // showing a request nobody could clear.
    pendingPermissions.remove(requestId)
    announceLive('')
    return { ok: false, reason: 'that request is no longer waiting' }
  }
  return { ok: true }
}

function registerRunActions(api: ExtensionAPI): void {
  // The four things you do about a run that has stopped making progress, and
  // the one you do about any run. Without these the supervision panel could
  // name a stall and offer nothing — which is the shape of every "correct and
  // useless" surface this line of work exists to stop shipping.
  reg(
    api,
    sessionChannel('foundry:run-terminal', SessionPayload, ({ sessionId }) =>
      goToRunTerminal(api, sessionId)
    ),
    // What it was doing, in its own words. The action that decides the others.
    defineChannel({
      channel: 'foundry:run-transcript',
      schema: TranscriptPayload,
      invalid: { lines: [] },
      run: ({ sessionId, limit }) => {
        const run = runtime.supervision?.runs.get(sessionId) ?? null
        if (run === null) return { lines: [] }
        return { lines: readTranscriptTail(run.transcriptPath, limit ?? 40) }
      },
    }),
    // Ends the turn and keeps the session, which is what makes the next message
    // land instead of queueing behind whatever it is part-way through.
    sessionChannel('foundry:run-interrupt', SessionPayload, ({ sessionId }) => {
      if (runtime.supervisedRunner === null) return { ok: false }
      runtime.supervisedRunner.interrupt(sessionId)
      return { ok: true }
    }),
    sessionChannel('foundry:run-redirect', RedirectPayload, redirectRun),
    sessionChannel('foundry:run-stop', SessionStopPayload, stopSessionOnRequest)
  )
}

// Takes you to the terminal the run is in.
//
// Done here rather than in the panel: the extension's UI is a separate
// renderer process, so a store it imports from core is a second copy that
// nothing renders. `terminal:navigate-to-session` is the core's own channel
// for this — it selects the workspace, the project and the tab.
function goToRunTerminal(api: ExtensionAPI, sessionId: string): { ok: boolean } {
  const terminal = runtime.supervisedRunner?.terminalFor(sessionId) ?? null
  if (terminal === null) return { ok: false }
  api.window.focusSelf()
  api.window.broadcast('terminal:navigate-to-session', {
    sessionId: terminal.terminalSessionId,
    projectId: terminal.projectId,
  })
  return { ok: true }
}

// Asking it what is wrong, or telling it what to do instead — the same
// action, and the reason interrupt does not also end the run. The schema
// trims the message and refuses an empty one.
function redirectRun({ sessionId, message }: z.infer<typeof RedirectPayload>): { ok: boolean } {
  if (runtime.supervisedRunner === null) return { ok: false }
  runtime.supervisedRunner.interrupt(sessionId)
  const ok = runtime.supervisedRunner.send(sessionId, message)
  if (ok) {
    runtime.supervision?.runs.setState(sessionId, 'working', Date.now())
    runtime.supervision?.feed.post({
      at: Date.now(),
      sessionId,
      author: 'console',
      summary: `redirected: ${message}`,
    })
  }
  return { ok }
}

// Ends the run, saying why first so the agent's own record carries it.
function stopSessionOnRequest({ sessionId, reason }: z.infer<typeof SessionStopPayload>): {
  ok: boolean
} {
  if (runtime.supervisedRunner === null) return { ok: false }
  const ok = runtime.supervisedRunner.stop(sessionId, reason)
  if (ok) {
    runtime.supervision?.finish(sessionId, Date.now())
    // Recorded before it leaves the live list, so a run somebody stopped is
    // still answerable later — "what was it doing when I killed it".
    runtime.supervision?.runs.archive(sessionId, 'stopped', Date.now())
  }
  return { ok }
}
