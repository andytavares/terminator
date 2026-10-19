import type { ExtensionAPI } from '@terminator/extension-sdk'
import { shellQuote } from '@terminator/extension-sdk/node'
import type { DashboardPR } from '../schemas/pr-review.schema.js'
import { canonical } from '../ipc/repo-root.js'
import { openPrReviewWindow } from '../review-command.js'
import { projectForCheckout } from '../review/terminal-project.js'
import { runGit } from '../shell/run-git.js'
import { pullRequestId, reviewTarget } from './feed.js'

/** What the action handler reaches: the api, the folder gh may run in, and the pull requests Home shows. */
interface ActionDeps {
  api: ExtensionAPI
  storage: string
  pullRequests: () => DashboardPR[]
}

/** The folder `branch` is checked out in, from `git worktree list --porcelain`.
 * @internal */
export function worktreeOfBranch(porcelain: string, branch: string): string | undefined {
  const block = porcelain
    .split('\n\n')
    .find((entry) => entry.split('\n').includes(`branch refs/heads/${branch}`))
  return block?.split('\n')[0].replace(/^worktree /, '')
}

function openReviewWindowFor(api: ExtensionAPI, pr: DashboardPR): void {
  const { repoRoot, number } = reviewTarget(pr)
  openPrReviewWindow(api, { repoRoot, prNumber: String(number) })
}

const RUN_ID = /\/actions\/runs\/(\d+)/

/** gh args that open the first failing check's run, else the pull request's checks page. */
function logOpeningArgs(pr: DashboardPR): string[] {
  const detailsUrl = pr.checks?.find((check) => check.state === 'failed')?.detailsUrl
  const runId = detailsUrl ? RUN_ID.exec(detailsUrl)?.[1] : undefined
  return runId ? ['run', 'view', runId, '--web', '-R', pr.repo] : ['pr', 'checks', pr.url, '--web']
}

/** gh opens the page in the browser; the SDK has no other way to open a URL. */
async function openLog({ api, storage }: ActionDeps, pr: DashboardPR): Promise<void> {
  await api.shell.exec({ command: 'gh', args: logOpeningArgs(pr), cwd: storage })
}

async function agentSessionIn(api: ExtensionAPI, folder: string): Promise<string | undefined> {
  const sessions = await api.pty.listSessions()
  return sessions.find((s) => s.type === 'agent' && canonical(s.cwd) === canonical(folder))
    ?.sessionId
}

/** A terminal to open in `folder` and the one line to start it with. */
interface AgentLaunch {
  folder: string
  tabTitle: string
  message: string
}

async function startAgentIn(api: ExtensionAPI, { folder, tabTitle, message }: AgentLaunch) {
  const projectId = projectForCheckout(api.workspace, folder)
  if (!projectId) return api.log.warn(`home: no project holds ${folder}; nothing sent to an agent`)
  const sessionId = await api.pty.openTerminal({
    projectId,
    cwd: folder,
    tabTitle,
    type: 'agent',
  })
  if (sessionId) api.pty.write(sessionId, `claude ${shellQuote(message)}\r`)
}

async function sendToAgent({ api }: ActionDeps, pr: DashboardPR): Promise<void> {
  const branch = pr.headRefName ?? ''
  const folder =
    pr.localRepoRoot && branch
      ? worktreeOfBranch(
          await runGit(pr.localRepoRoot, ['worktree', 'list', '--porcelain']),
          branch
        )
      : undefined
  if (!folder) return api.log.warn(`home: ${branch || pr.url} is checked out nowhere; nothing sent`)
  const message = `Checks are failing on ${pr.url}. Find the failing checks, fix them and push.`
  const sessionId = await agentSessionIn(api, folder)
  if (sessionId) api.pty.write(sessionId, `${message}\r`)
  else await startAgentIn(api, { folder, tabTitle: `Fix checks #${pr.number}`, message })
}

const ACTIONS: Record<string, (deps: ActionDeps, pr: DashboardPR) => void | Promise<void>> = {
  'start-review': ({ api }, pr) => openReviewWindowFor(api, pr),
  'open-log': openLog,
  'send-to-agent': sendToAgent,
}

/** The handler for `api.home.onAction`; the item id is `<kind>:<owner/name>#<number>`. */
export function createHomeActionHandler(deps: ActionDeps) {
  return async (itemId: string, actionId: string): Promise<void> => {
    const pr = deps.pullRequests().find((p) => pullRequestId(p) === itemId.replace(/^[a-z]+:/, ''))
    const run = ACTIONS[actionId]
    if (!pr || !run) return deps.api.log.warn(`home: no ${actionId} for ${itemId}`)
    await run(deps, pr)
  }
}
