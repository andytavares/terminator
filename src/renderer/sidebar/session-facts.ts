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
  /** Epoch ms of when this session last became the visible one, null when it never has. */
  lastAttendedAt: number | null
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

/** What a Home row or a wall tile can do to the session it shows. */
export interface SessionActions {
  onOpen: (sessionId: string) => void
  onSaveDescription: (facts: SessionFacts, description: string | null) => void
  onLink?: (facts: SessionFacts) => void
  onResume?: (facts: SessionFacts) => void
  onCloseSession?: (facts: SessionFacts) => void
  onForgetSession?: (facts: SessionFacts) => void
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

/** What an open session's record adds: its description and the agent that ran in it. */
function recordFacts(record: SessionRecordListing | undefined) {
  return {
    description: record?.description ?? null,
    agent: record?.agent ?? null,
    resumable: record?.resumable === true,
  }
}

/** Where the session runs, as its record keeps it. */
function openSnapshot(
  session: TerminalSession,
  project: Project | undefined,
  workspace: Workspace | undefined
): SessionSnapshot {
  return {
    sessionId: session.id,
    projectId: session.projectId,
    workspaceName: workspace?.name ?? null,
    projectName: project?.name ?? null,
    // A project with no git branch has no branch to show; its name is already the project's.
    branch: project?.gitBranch ?? null,
    tabTitle: session.tabTitle,
    shell: session.shell ?? null,
    startedAt: session.createdAt,
  }
}

/** What the running terminal itself says: when it was last used and what it last printed. */
function liveFacts(session: TerminalSession) {
  return {
    state: stateSource.derive(session),
    lastActivityAt: session.lastActivityAt,
    lastAttendedAt: session.lastAttendedAt ?? null,
    latestLine: session.latestLine ?? '',
    choicePrompt: session.choicePrompt ?? null,
  }
}

/** The repo's tags, and "agent" for a terminal an agent runs in. */
function tagsOf(session: TerminalSession, workspace: Workspace | undefined): string[] {
  return [...(workspace?.tags ?? []), ...(session.type === 'agent' ? [AGENT_TAG] : [])]
}

/** The session's own link, or else its project's. */
function workItemOf(
  record: SessionRecordListing | undefined,
  project: Project | undefined,
  projectLinks: SessionFactsInput['projectLinks']
): WorkItem | null {
  const projectLink = project ? (projectLinks.get(project.id) ?? null) : null
  return resolveWorkItem(record?.link ?? null, projectLink)
}

function openFacts(
  session: TerminalSession,
  input: SessionFactsInput,
  record: SessionRecordListing | undefined
): SessionFacts {
  const project = input.projects.find((p) => p.id === session.projectId)
  const workspace = project && input.workspaces.find((w) => w.id === project.workspaceId)
  const snapshot = openSnapshot(session, project, workspace)
  return {
    ...liveFacts(session),
    ...recordFacts(record),
    sessionId: session.id,
    name: session.tabTitle,
    isClosed: false,
    projectId: project?.id ?? null,
    workspaceName: snapshot.workspaceName,
    workspaceColor: workspace?.color ?? null,
    projectName: snapshot.projectName,
    branch: snapshot.branch,
    shell: snapshot.shell,
    tags: tagsOf(session, workspace),
    workItem: workItemOf(record, project, input.projectLinks),
    startedAt: session.createdAt,
    closedAt: null,
    snapshot,
  }
}

/** What a closed session no longer has: a live state, a project, a screen. */
const CLOSED = {
  state: 'exited',
  isClosed: true,
  projectId: null,
  workspaceColor: null,
  lastAttendedAt: null,
  latestLine: '',
  choicePrompt: null,
} as const

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
    ...CLOSED,
    tags: [],
    sessionId: record.sessionId,
    name: record.tabTitle,
    workspaceName: record.workspaceName,
    projectName: record.projectName,
    branch: record.branch,
    shell: record.shell,
    workItem: resolveWorkItem(link, null),
    description,
    lastActivityAt: Date.parse(closedAt),
    startedAt: record.startedAt,
    closedAt,
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

/** Oldest first. */
export const byStarted = (a: SessionFacts, b: SessionFacts): number =>
  Date.parse(a.startedAt) - Date.parse(b.startedAt)

/** Most recently opened first, a session that has never been attended sorting last. */
export const byRecentlyOpened = (a: SessionFacts, b: SessionFacts): number => {
  if (a.lastAttendedAt === null && b.lastAttendedAt === null) return byStarted(a, b)
  if (a.lastAttendedAt === null) return 1
  if (b.lastAttendedAt === null) return -1
  return b.lastAttendedAt - a.lastAttendedAt || byStarted(a, b)
}
