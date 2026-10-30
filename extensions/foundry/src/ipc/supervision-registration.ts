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
import { RunLogPayload, runLog } from './run-log.js'
import { readTranscriptTail } from '../runtime/transcript-excerpt.js'

import { reg } from './register.js'
import { announceLive } from '../state/live-index.js'
import { stallShadowMode } from '../state/settings.js'
import { runtime, pendingPermissions, stallFirings } from '../runtime/runtime-state.js'

// What the console needs from the supervision runtime: held calls, stalls, the
// feed, answering a held call, and the actions on one run.
export function registerSupervisionChannels(api: ExtensionAPI): void {
  registerFeedChannels(api)
  registerPermissionAnswers(api)
  registerRunActions(api)
}

function registerFeedChannels(api: ExtensionAPI): void {
  // What a supervised run waits on and how the operator answers it, so the console
  // answers its agents instead of waiting for the bridge to hand back to the terminal.
  reg(
    api,
    foundryChannel('foundry:permissions-list', noPayload, permissionsList),
    // The firings, and whether they were recorded or surfaced. Precision is
    // measured against these by hand before shadow mode is turned off.
    foundryChannel('foundry:stalls-list', noPayload, () => stallsList(api)),
    foundryChannel('foundry:feed-list', noPayload, feedList),
    // Anything shown as a list should be prunable, and a feed you cannot clear a
    // line from is one you stop reading.
    foundryChannel('foundry:feed-dismiss', FeedDismissPayload, dismissFeedEntry),
    foundryChannel('foundry:feed-mute', FeedMutePayload, muteFeed),
    foundryChannel('foundry:feed-unmute', FeedMutePayload, unmuteFeed)
  )
}

export const permissionsList = () => ({ pending: pendingPermissions.list() })

export const stallsList = (api: ExtensionAPI) => ({
  firings: stallFirings,
  shadowMode: stallShadowMode(api),
})

export const feedList = () => ({
  entries: runtime.supervision?.feed.list() ?? [],
  mutes: runtime.mutes?.list() ?? [],
})

export function dismissFeedEntry({ id }: z.infer<typeof FeedDismissPayload>) {
  runtime.supervision?.feed.removeEntry(id)
  return { ok: true }
}

export function muteFeed(rule: z.infer<typeof FeedMutePayload>) {
  runtime.mutes?.add(rule)
  announceLive('')
  return { mutes: runtime.mutes?.list() ?? [] }
}

export function unmuteFeed(rule: z.infer<typeof FeedMutePayload>) {
  runtime.mutes?.remove(rule)
  announceLive('')
  return { mutes: runtime.mutes?.list() ?? [] }
}

export function interruptRun({ sessionId }: z.infer<typeof SessionPayload>) {
  if (runtime.supervisedRunner === null) return { ok: false }
  runtime.supervisedRunner.interrupt(sessionId)
  return { ok: true }
}

export function handBackPermission({ requestId }: z.infer<typeof PermissionHandBackPayload>) {
  const sessionId = pendingPermissions.sessionFor(requestId)
  if (sessionId === null || runtime.supervisedRunner === null) return { ok: false }
  runtime.supervisedRunner.handBackToTerminal(sessionId, requestId)
  return { ok: true }
}

export function transcriptTail({ sessionId, limit }: z.infer<typeof TranscriptPayload>) {
  const run = runtime.supervision?.runs.get(sessionId) ?? null
  if (run === null) return { lines: [] }
  return { lines: readTranscriptTail(run.transcriptPath, limit ?? 40) }
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
    sessionChannel('foundry:permission-hand-back', PermissionHandBackPayload, handBackPermission)
  )
}

export function resolvePermission({
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
  // The four moves for a run that stopped progressing, and the one for any run: a
  // panel that names a stall and offers nothing is useless.
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
      run: transcriptTail,
    }),
    // Every station's words, the ledger and the command logs, merged: the hall's whiteboard.
    defineChannel({
      channel: 'foundry:run-log',
      schema: RunLogPayload,
      invalid: { lines: [] },
      run: (payload) => runLog(api, payload),
    }),
    // Ends the turn and keeps the session, which is what makes the next message
    // land instead of queueing behind whatever it is part-way through.
    sessionChannel('foundry:run-interrupt', SessionPayload, interruptRun),
    sessionChannel('foundry:run-redirect', RedirectPayload, redirectRun),
    sessionChannel('foundry:run-stop', SessionStopPayload, stopSessionOnRequest)
  )
}

// Takes you to the run's terminal through the core's `terminal:navigate-to-session`
// (workspace, project, tab): the extension's UI is another renderer, where a core
// store it imported would be a copy nothing renders.
export function goToRunTerminal(api: ExtensionAPI, sessionId: string): { ok: boolean } {
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
export function redirectRun({ sessionId, message }: z.infer<typeof RedirectPayload>): {
  ok: boolean
} {
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
export function stopSessionOnRequest({ sessionId, reason }: z.infer<typeof SessionStopPayload>): {
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
