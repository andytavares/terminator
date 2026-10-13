import { z } from 'zod'
import { defineChannel, noPayload } from '@terminator/extension-sdk'
import type {
  ChannelSpec,
  ExtensionAPI,
  Disposable,
  SettingDefinition,
} from '@terminator/extension-sdk'
import { registerGitExtensionHandlers } from './ipc/git.ipc.js'
import { gitEnabled, gitEnabledAnywhere, gitSettings, MAX_DISPLAYED_FILES } from './git-settings.js'
import { gatedByWorkspace } from './ipc/workspace-switch.js'
import { bindWorkspaceRoots } from './ipc/repo-root.js'
import { projectForCheckout } from './review/terminal-project.js'
import { VALIDATION_ERROR, type RegisterFn } from './ipc/register.js'
import { registerGithubHandlers, type GithubHandlerOptions } from './ipc/github.ipc.js'
import { registerReviewAgentHandlers, type OpenTerminalInput } from './ipc/review-agent.ipc.js'
import { consumePendingViewRequest, registerQuickActionCommands } from './commands.js'
import { remoteAccessFor } from './remote-access.js'
import { bindShell } from './shell/run-git.js'
import { openStorageDirectory } from './storage-directory.js'
import {
  openPrReviewWindow,
  registerReviewPullRequestCommand,
  registerReviewSubmittedRelay,
  registerReviewSettings,
  PrReviewWindowParams,
} from './review-command.js'

/** A notification the isolated view asks the shared dispatcher to raise. */
const NotifyPayload = z.object({
  type: z.enum(['info', 'success', 'warning', 'error']),
  title: z.string().min(1),
  key: z.string().min(1),
  message: z.string().optional(),
})

// Every notification kind this extension ever raises, so the user can
// independently choose its delivery target(s) (system/in-app/toast) in this
// extension's own settings — core never knows these keys exist (Extension Isolation).
const NOTIFICATION_KEYS: { key: string; label: string }[] = [
  { key: 'sidebarToggleHint', label: 'Sidebar toggle hint' },
  { key: 'gitViewOpened', label: 'Git view opened' },
  { key: 'commitFailed', label: 'Commit failed' },
  { key: 'commitPushFailed', label: 'Committed but push failed' },
  { key: 'conflictResolveFailed', label: 'Could not resolve conflict' },
  { key: 'conflictUndoFailed', label: 'Could not undo conflict resolution' },
  { key: 'loadConflictsFailed', label: 'Could not load conflicts' },
  { key: 'noConflictsFound', label: 'No merge conflicts found' },
  { key: 'openResolverFailed', label: 'Could not open conflict resolver' },
  { key: 'resetFailed', label: 'Could not reset merge session' },
  { key: 'reloadConflictsFailed', label: 'Could not reload conflicts' },
  { key: 'startOverFailed', label: 'Start over failed' },
  { key: 'pushSucceeded', label: 'Push succeeded' },
  { key: 'pushFailed', label: 'Push failed' },
  { key: 'pullSucceeded', label: 'Pull succeeded' },
  { key: 'pullFailed', label: 'Pull failed' },
  { key: 'prCreated', label: 'Pull request opened' },
]

function buildNotificationSettingProperties(): Record<string, SettingDefinition> {
  const properties: Record<string, SettingDefinition> = {}
  for (const { key, label } of NOTIFICATION_KEYS) {
    properties[`terminator.git-integration.notify.${key}.system`] = {
      type: 'boolean',
      label: `${label} → System notification`,
      default: true,
    }
    properties[`terminator.git-integration.notify.${key}.center`] = {
      type: 'boolean',
      label: `${label} → In-app notification center`,
      default: true,
    }
    properties[`terminator.git-integration.notify.${key}.toast`] = {
      type: 'boolean',
      label: `${label} → Toast`,
      default: true,
    }
  }
  return properties
}

const SETTING = 'terminator.git-integration'

const SETTINGS: Record<string, SettingDefinition> = {
  'terminator.git-integration.git.enabled': {
    type: 'boolean',
    label: 'Enable Git Integration',
    default: true,
    workspaceScoped: true,
  },
  'terminator.git-integration.git.githubToken': {
    type: 'string',
    label: 'GitHub token',
    description:
      'Personal access token or fine-grained token with repo scope. Used as GH_TOKEN when running gh commands.',
    default: '',
    secret: true,
  },
  'terminator.git-integration.git.commit.signOff': {
    type: 'boolean',
    label: 'Add sign-off to commits',
    description: 'Commits from the Git view end with a Signed-off-by line (git commit --signoff).',
    default: false,
    workspaceScoped: true,
  },
  'terminator.git-integration.git.maxDisplayedFiles': {
    type: 'number',
    label: 'Max displayed changed files',
    description:
      'The Git view lists this many changed files at most, and says when there are more.',
    default: MAX_DISPLAYED_FILES.default,
    min: MAX_DISPLAYED_FILES.min,
    max: MAX_DISPLAYED_FILES.max,
  },
  'terminator.git-integration.review.agentModel': {
    type: 'enum',
    label: 'Review agent model',
    options: ['opus', 'sonnet'],
    default: 'sonnet',
  },
  'terminator.git-integration.review.agentEffort': {
    type: 'enum',
    label: 'Review agent effort',
    options: ['default', 'low', 'medium', 'high'],
    default: 'default',
  },
  'terminator.git-integration.review.cloneFolder': {
    type: 'folder',
    label: 'Clone folder for reviews',
    description:
      'Where "Clone and review" puts repositories you have not cloned. Empty keeps reviews diff-only.',
    default: '',
  },
  'terminator.git-integration.review.agentTimeoutMinutes': {
    type: 'number',
    label: 'Review agent timeout (minutes)',
    default: 5,
    min: 1,
    max: 30,
  },
  ...buildNotificationSettingProperties(),
}

const disposables: Disposable[] = []

/** Each workspace project's checkout, or its workspace folder. */
function projectRootsOf(api: ExtensionAPI): () => string[] {
  return () =>
    api.workspace
      .list()
      .flatMap((w) => api.workspace.listProjects(w.id).map((p) => p.worktreePath ?? w.folderPath))
}

/** The roots a channel may run git or gh in: workspace folders, projects and the clone folder. */
function bindRoots(api: ExtensionAPI, projectRoots: () => string[]): void {
  bindWorkspaceRoots(() => [
    ...api.workspace.list().map((w) => w.folderPath),
    ...projectRoots(),
    api.settings.get<string>(`${SETTING}.review.cloneFolder`) ?? '',
  ])
}

/** Opens an agent terminal in the project the repo belongs to and types the command into it. */
async function openAgentTerminal(api: ExtensionAPI, input: OpenTerminalInput): Promise<void> {
  const projectId = projectForCheckout(api.workspace, input.repoRoot)
  if (!projectId) return
  const sessionId = await api.pty.openTerminal({
    projectId,
    cwd: input.cwd,
    tabTitle: input.title,
    type: 'agent',
  })
  if (sessionId) api.pty.write(sessionId, `${input.command}\r`)
}

/** The workspace's project roots, and the extension's own folder, where a gh call that needs no checkout runs. */
interface ChannelRoots {
  projectRoots: () => string[]
  storage: string
}

function registerGithub(api: ExtensionAPI, registerFn: RegisterFn, roots: ChannelRoots) {
  const access = {
    github: api.github,
    getToken: () => api.settings.get<string>(`${SETTING}.git.githubToken`) ?? '',
    noCheckoutCwd: roots.storage,
  }
  const options: GithubHandlerOptions = {
    // Optional: an older host has no issues namespace, and the review view
    // then renders references exactly as it does today.
    issues: api.issues,
    listProjectRoots: roots.projectRoots,
    getReviewRepos: () => api.settings.get<string[]>(`${SETTING}.review.repos`) ?? [],
    // Settings → Git → Branch Exclude Patterns, matched by the core.
    isBranchExcluded: (branch, repoPath) => api.settings.isBranchExcluded(branch, repoPath),
  }
  registerGithubHandlers(registerFn, access, options)
}

/** Every channel this extension answers, each with its remote-access rule. */
function registerChannels(api: ExtensionAPI, roots: ChannelRoots): void {
  // A repository whose workspace switched the extension off is answered GIT_DISABLED.
  const isEnabled = (repoPath?: string) => gitEnabled(api, repoPath)
  const registerFn = (spec: ChannelSpec) => {
    const gated = gatedByWorkspace(spec, isEnabled)
    disposables.push(api.ipc.registerHandler(gated, remoteAccessFor(spec.channel)))
  }
  registerGitExtensionHandlers(registerFn, gitSettings(api))
  registerFn(pendingRequestChannel())
  registerGithub(api, registerFn, roots)
  // Read-only review agent: headless `claude -p` in a detached PR-head worktree.
  const reviewAgent = registerReviewAgentHandlers(registerFn, {
    getSetting: (key) => api.settings.get(key),
    broadcast: (channel, data) => api.window.broadcast(channel, data),
    openTerminal: (input) => openAgentTerminal(api, input),
  })
  disposables.push(reviewAgent)
}

/** Bridges this extension's renderer (an isolated webview, with no api.notifications) to the shared
 *  notification dispatcher. */
function notifyChannel(api: ExtensionAPI): ChannelSpec {
  return defineChannel({
    channel: 'git:notify',
    schema: NotifyPayload,
    invalid: VALIDATION_ERROR,
    run: (notification) => {
      api.notifications.createNotification(notification)
      return { ok: true }
    },
  })
}

/** Hands the Git view the Commit… or Create PR… request a command left before the view existed. */
function pendingRequestChannel(): ChannelSpec {
  return defineChannel({
    channel: 'git:ui.consume-pending-request',
    schema: noPayload,
    invalid: VALIDATION_ERROR,
    run: () => ({ request: consumePendingViewRequest() }),
  })
}

function openReviewWindowChannel(api: ExtensionAPI): ChannelSpec {
  return defineChannel({
    channel: 'window:open-pr-review',
    schema: PrReviewWindowParams,
    invalid: VALIDATION_ERROR,
    run: (params) => {
      openPrReviewWindow(api, params ?? {})
      return { ok: true }
    },
  })
}

/** Commands, the view menu item and the two window channels. */
function contributions(api: ExtensionAPI): Disposable[] {
  return [
    ...registerQuickActionCommands(api),
    registerReviewPullRequestCommand(api),
    registerReviewSubmittedRelay(api),
    ...registerReviewSettings(api),
    api.ipc.registerHandler(notifyChannel(api)),
    api.nativeMenu.addViewMenuItem({
      id: 'open-pr-review',
      label: 'Code Reviews in New Window',
      onClick: () => api.window.openAuxiliary('pr-review', {}),
    }),
    api.ipc.registerHandler(openReviewWindowChannel(api)),
  ]
}

export function activate(api: ExtensionAPI): void {
  // Registered before the enabled check: switched off globally and in every
  // workspace, the extension registers nothing else, and the settings page is
  // the only way back on.
  disposables.push(api.settings.register({ label: 'Git Integration', properties: SETTINGS }))
  if (!gitEnabledAnywhere(api)) return
  bindShell(api.shell)
  const storage = openStorageDirectory(api)
  const projectRoots = projectRootsOf(api)
  bindRoots(api, projectRoots)
  registerChannels(api, { projectRoots, storage })
  disposables.push(...contributions(api))
}

export function deactivate(): void {
  disposables.forEach((d) => d.dispose())
  disposables.length = 0
}
