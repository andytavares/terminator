import { z } from 'zod'
import type { BrowserWindow } from 'electron'
import { registerInvokeTable, invokeSpec } from './invoke-table.js'
import { sendToWindow } from '../safe-send.js'
import { z as zod } from 'zod'
import {
  ConnectInputSchema,
  DisconnectInputSchema,
  IssueCommentInputSchema,
  IssueGetInputSchema,
  LinkSetInputSchema,
  ListMineInputSchema,
  ProjectIdInputSchema,
  SearchInputSchema,
  SetMineInputSchema,
  StatusInputSchema,
} from '../../shared/schemas/integrations.schema.js'
import type { TrackerId } from '../../shared/types/index.js'
import { getIssueService, resetIssueService } from '../integrations/index.js'
import { createJiraProvider } from '../integrations/providers/jira.provider.js'
import { createLinearProvider } from '../integrations/providers/linear.provider.js'
import type { StoredCredential } from '../integrations/providers/provider.js'
import {
  clearCredential,
  listConnections,
  setAccount,
  setCredential,
  setMine,
} from '../integrations/tracker-store.js'
import { toErrorKind, toErrorMessage } from '../integrations/tracker-error.js'
import { clearLink, getLink, setInjectContext, setLink } from '../integrations/issue-link-store.js'
import {
  clearProjectContext,
  previewProjectContext,
  syncProjectContext,
} from '../integrations/context-sync.js'

// The renderer's way in. Every payload is validated by the shared schemas and
// every failure comes back as an envelope carrying a kind from the taxonomy —
// nothing throws across the boundary, and nothing here ever returns a secret.

function fail(error: unknown): { error: string; message: string } {
  return { error: toErrorKind(error), message: toErrorMessage(error) }
}

const VALIDATION = { error: 'failed', message: 'Invalid payload' }

/** The providers used to prove a credential before it is stored. */
const verifiers = {
  linear: createLinearProvider(),
  jira: createJiraProvider(),
}

function credentialOf(input: z.infer<typeof ConnectInputSchema>): StoredCredential {
  return input.tracker === 'linear'
    ? { tracker: 'linear', apiKey: input.apiKey }
    : {
        tracker: 'jira',
        site: input.site,
        email: input.email,
        apiToken: input.apiToken,
      }
}

/**
 * How this layer reaches the window. Injected rather than imported so the
 * handlers stay testable and so a push to a window that has already closed is
 * dropped rather than thrown (see safe-send).
 */
let getWindow: () => BrowserWindow | null = () => null

function announceLink(projectId: string): void {
  sendToWindow(getWindow(), 'integrations:link-changed', {
    projectId,
    link: getLink(projectId),
  })
}

async function announceStatus(): Promise<void> {
  sendToWindow(getWindow(), 'integrations:status-changed', {
    connections: await listConnections(),
  })
}

export function registerIntegrationsHandlers(
  window: () => BrowserWindow | null = () => null
): void {
  getWindow = window
  registerInvokeTable([
    invokeSpec({
      channel: 'integrations:status',
      schema: StatusInputSchema,
      invalid: VALIDATION,
      run: async ({ tracker }) => {
        const connections = await listConnections()
        return {
          connections:
            tracker === undefined ? connections : connections.filter((c) => c.tracker === tracker),
        }
      },
      onError: fail,
    }),

    invokeSpec({
      channel: 'integrations:connect',
      schema: ConnectInputSchema,
      invalid: VALIDATION,
      run: async (input) => {
        const cred = credentialOf(input)
        // Verified before it is stored, so a bad paste fails here rather than
        // three screens later as an empty issue list.
        const account = await verifiers[input.tracker].verify(cred)
        await setCredential(cred)
        await setAccount(input.tracker, { name: account.name, email: account.email })
        if (input.tracker === 'linear') {
          await setMine('linear', { kind: 'assignee', email: input.email ?? null })
        } else {
          await setMine('jira', { kind: 'query', jql: input.jql })
        }
        // The service holds a client built from the old credential.
        resetIssueService()
        const connections = await listConnections()
        // Every open surface learns about it, not just the settings panel that
        // did the connecting.
        await announceStatus()
        return { connection: connections.find((c) => c.tracker === input.tracker) }
      },
      onError: fail,
    }),

    invokeSpec({
      channel: 'integrations:disconnect',
      schema: DisconnectInputSchema,
      invalid: VALIDATION,
      run: async ({ tracker }) => {
        await clearCredential(tracker)
        resetIssueService()
        await announceStatus()
        return { ok: true }
      },
      onError: fail,
    }),

    invokeSpec({
      channel: 'integrations:set-mine',
      schema: SetMineInputSchema,
      invalid: VALIDATION,
      run: async ({ tracker, mine }) => {
        await setMine(tracker, mine)
        await announceStatus()
        return { ok: true }
      },
      onError: fail,
    }),

    invokeSpec({
      channel: 'integrations:issue-list-mine',
      schema: ListMineInputSchema,
      invalid: VALIDATION,
      run: async ({ tracker, limit }) =>
        getIssueService().listMine({ tracker: tracker as TrackerId | undefined, limit }),
      onError: fail,
    }),

    invokeSpec({
      channel: 'integrations:issue-search',
      schema: SearchInputSchema,
      invalid: VALIDATION,
      run: async ({ term, tracker, limit }) =>
        getIssueService().search(term, { tracker: tracker as TrackerId | undefined, limit }),
      onError: fail,
    }),

    invokeSpec({
      channel: 'integrations:issue-get',
      schema: IssueGetInputSchema,
      invalid: VALIDATION,
      run: async ({ tracker, key, refresh }) => ({
        issue: await getIssueService().get(tracker, key, { refresh }),
      }),
      onError: fail,
    }),

    invokeSpec({
      channel: 'integrations:link-set',
      schema: LinkSetInputSchema,
      invalid: VALIDATION,
      run: async ({ projectId, tracker, key, injectContext }) => {
        // Replaces whatever was there; warning the operator first is the
        // caller's job, and doing it here would make the channel un-scriptable.
        const link = await setLink({ projectId, tracker, key, injectContext })
        try {
          await syncProjectContext(projectId, getIssueService())
        } catch (error) {
          // A link that cannot feed a session is worse than no link: it looks
          // attached and silently does nothing. Undo it and say why (FR-026).
          await clearLink(projectId)
          announceLink(projectId)
          throw error
        }
        announceLink(projectId)
        return { link }
      },
      onError: fail,
    }),

    invokeSpec({
      channel: 'integrations:link-get',
      schema: ProjectIdInputSchema,
      invalid: VALIDATION,
      run: async ({ projectId }) => {
        const link = getLink(projectId)
        if (link === null) return { link: null, issue: null }
        try {
          return { link, issue: await getIssueService().get(link.tracker, link.key) }
        } catch (error) {
          // The association exists and the issue could not be read. Both facts
          // matter: the badge renders unavailable rather than vanishing.
          // Named issueError, not error: the call succeeded, and a caller
          // narrowing on `error` must not mistake this for a failed channel.
          return { link, issue: null, issueError: toErrorKind(error) }
        }
      },
      onError: fail,
    }),

    invokeSpec({
      channel: 'integrations:link-clear',
      schema: ProjectIdInputSchema,
      invalid: VALIDATION,
      run: async ({ projectId }) => {
        await clearLink(projectId)
        await clearProjectContext(projectId)
        announceLink(projectId)
        return { ok: true }
      },
      onError: fail,
    }),

    invokeSpec({
      channel: 'integrations:context-preview',
      schema: ProjectIdInputSchema,
      invalid: VALIDATION,
      run: async ({ projectId }) => ({
        context: await previewProjectContext(projectId, getIssueService()),
      }),
      onError: fail,
    }),

    invokeSpec({
      channel: 'integrations:set-inject-context',
      schema: zod.object({
        projectId: zod.string().uuid(),
        injectContext: zod.boolean(),
      }),
      invalid: VALIDATION,
      run: async ({ projectId, injectContext }) => {
        await setInjectContext(projectId, injectContext)
        // Turning it off removes what was written into the project directory;
        // turning it on puts it back.
        await syncProjectContext(projectId, getIssueService())
        announceLink(projectId)
        return { ok: true }
      },
      onError: fail,
    }),

    invokeSpec({
      channel: 'integrations:issue-comment',
      schema: IssueCommentInputSchema,
      invalid: VALIDATION,
      run: async ({ tracker, key, body }) => {
        // Failure is returned, never swallowed — the whole point of FR-034a.
        await getIssueService().comment(tracker, key, body)
        return { ok: true }
      },
      onError: fail,
    }),
  ])
}
