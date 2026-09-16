import { resolveWorkItem, type WorkItem } from './work-item'
import { BellAndBusySource } from './agent-state'
import type {
  AgentConversation,
  AgentState,
  ChoicePrompt,
  IssueLink,
  Project,
  SessionRecordListing,
  SessionSnapshot,
  TerminalSession,
  Workspace,
} from '../../shared/types/index'

/**
 * Everything Home and the wall say about one session, in one shape.
 *
 * A closed session exists only as its record, so its facts come from the
 * snapshot taken while it ran rather than from a project that may be gone.
 */
export interface SessionFacts {
  sessionId: string
  name: string
  state: AgentState
  /** True for a session whose tab has gone and which survives only as a record. */
  isClosed: boolean
  /** null for a scratch terminal, a closed session, or one whose project has gone. */
  projectId: string | null
  workspaceName: string | null
  workspaceColor: string | null
  projectName: string | null
  branch: string | null
  shell: string | null
  tags: string[]
  workItem: WorkItem | null
  description: string | null
  lastActivityAt: number
  startedAt: string
  closedAt: string | null
  latestLine: string
  choicePrompt: ChoicePrompt | null
  /** The agent conversation that ran in this session, when one was reported. */
  agent: AgentConversation | null
  /** Whether that conversation can be brought back on this machine right now. */
  resumable: boolean
  /** What a write to this session's record carries. */
  snapshot: SessionSnapshot
}

export interface SessionFactsInput {
  sessions: readonly TerminalSession[]
  records: readonly SessionRecordListing[]
  projects: readonly Project[]
  workspaces: readonly Workspace[]
  projectLinks: ReadonlyMap<string, IssueLink | null>
}

const AGENT_TAG = 'agent'

/** agentState is never stored; every surface derives it from the same signals. */
const stateSource = new BellAndBusySource()

function openFacts(
  session: TerminalSession,
  input: SessionFactsInput,
  record: SessionRecordListing | undefined
): SessionFacts {
  const project = input.projects.find((p) => p.id === session.projectId)
  const workspace = project && input.workspaces.find((w) => w.id === project.workspaceId)
  // A project with no git branch has no branch to show; its name is already the project's.
  const branch = project?.gitBranch ?? null
  const snapshot: SessionSnapshot = {
    sessionId: session.id,
    projectId: session.projectId,
    workspaceName: workspace?.name ?? null,
    projectName: project?.name ?? null,
    branch,
    tabTitle: session.tabTitle,
    shell: session.shell ?? null,
    startedAt: session.createdAt,
  }
  return {
    sessionId: session.id,
    name: session.tabTitle,
    state: stateSource.derive(session),
    isClosed: false,
    projectId: project?.id ?? null,
    workspaceName: snapshot.workspaceName,
    workspaceColor: workspace?.color ?? null,
    projectName: snapshot.projectName,
    branch,
    shell: snapshot.shell,
    tags: [...(workspace?.tags ?? []), ...(session.type === 'agent' ? [AGENT_TAG] : [])],
    workItem: resolveWorkItem(
      record?.link ?? null,
      project ? (input.projectLinks.get(project.id) ?? null) : null
    ),
    description: record?.description ?? null,
    lastActivityAt: session.lastActivityAt,
    startedAt: session.createdAt,
    closedAt: null,
    latestLine: session.latestLine ?? '',
    choicePrompt: session.choicePrompt ?? null,
    agent: record?.agent ?? null,
    resumable: record?.resumable === true,
    snapshot,
  }
}

function closedFacts(record: SessionRecordListing & { closedAt: string }): SessionFacts {
  const {
    description,
    link,
    agent,
    resumable,
    updatedAt: _updatedAt,
    closedAt,
    ...snapshot
  } = record
  return {
    sessionId: record.sessionId,
    name: record.tabTitle,
    state: 'exited',
    isClosed: true,
    projectId: null,
    workspaceName: record.workspaceName,
    workspaceColor: null,
    projectName: record.projectName,
    branch: record.branch,
    shell: record.shell,
    tags: [],
    workItem: resolveWorkItem(link, null),
    description,
    lastActivityAt: Date.parse(closedAt),
    startedAt: record.startedAt,
    closedAt,
    latestLine: '',
    choicePrompt: null,
    agent,
    resumable,
    snapshot,
  }
}

/**
 * One fact per open session, then one per closed record.
 *
 * An open record without its session is left out: it belongs to a session this
 * window has not adopted yet, and showing it as closed would be wrong.
 */
export function buildSessionFacts(input: SessionFactsInput): SessionFacts[] {
  const recordById = new Map(input.records.map((r) => [r.sessionId, r]))
  const open = input.sessions.map((s) => openFacts(s, input, recordById.get(s.id)))
  const openIds = new Set(input.sessions.map((s) => s.id))
  const closed = input.records
    .filter((r): r is SessionRecordListing & { closedAt: string } => r.closedAt !== undefined)
    .filter((r) => !openIds.has(r.sessionId))
    .map(closedFacts)
  return [...open, ...closed]
}
