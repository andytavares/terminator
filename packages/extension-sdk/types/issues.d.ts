/**
 * Issue-tracker types: one shape for every tracker. `api.issues` returns and
 * accepts these, and the core declares its own tracker code with them.
 */

export type TrackerId = 'linear'

/** A tracker and a key together identify an issue; the key alone does not. */
export interface IssueRef {
  tracker: TrackerId
  key: string
}

export type TrackerErrorKind =
  | 'not-connected'
  | 'auth-failed'
  | 'rate-limited'
  | 'unavailable'
  | 'not-found'
  | 'failed'
  /** The tracker cannot be asked to do this at all — not today, not on retry. Distinct from
   * 'failed' because a caller retries a failure and records an unsupported capability once (037
   * FR-063). */
  | 'unsupported'

/** How "my issues" is defined: Linear identifies an assignee directly. */
export interface MineSelector {
  kind: 'assignee'
  email: string | null
}

export interface TrackerAccount {
  name: string
  email: string
}

/** What the renderer is told about a tracker. Never carries the secret. */
export interface TrackerConnection {
  tracker: TrackerId
  connected: boolean
  /** Proof the credential was verified — absent means it never was. */
  account: TrackerAccount | null
  mine: MineSelector
  /** Set when a credential that worked starts failing. */
  lastError: TrackerErrorKind | null
}

export type IssueStateType = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'

export interface IssueState {
  /** The tracker's own label, displayed as-is. */
  name: string
  /** What the UI reasons about — never the colour. */
  type: IssueStateType
}

export interface IssueComment {
  author: string
  /** Markdown, normalised the same way as a description. */
  body: string
  createdAt: string
}

/** The subset lists and pickers need. No description, no comments. */
export interface IssueSummary {
  tracker: TrackerId
  /** The tracker's own stable id — a UUID for Linear. */
  id: string
  key: string
  title: string
  url: string
  state: IssueState
  assignee: TrackerAccount | null
  /** The tracker's suggested VCS branch. On the summary because the
   * new-project dialog prefills a branch from a picked row, and Linear returns it on the list's own
   * query: fetching the whole issue for one string would be a request for nothing. */
  branchName: string | null
}

export interface Issue extends IssueSummary {
  /** Always markdown. */
  description: string
  labels: string[]
  completed: boolean
  updatedAt: string
  /** Most recent first, bounded — a long thread is read in the tracker. */
  comments: IssueComment[]
}

/** A project's attachment to exactly one issue. */
export interface IssueLink {
  projectId: string
  tracker: TrackerId
  key: string
  injectContext: boolean
  linkedAt: string
}

export interface TrackerFailure {
  tracker: TrackerId
  error: TrackerErrorKind
}

/** A tracker that fails does not fail the call. Callers show what arrived and say what is
 * missing, rather than presenting a partial list as complete. */
export interface IssueListResult {
  issues: IssueSummary[]
  failures: TrackerFailure[]
}

/** Where to move an issue, as an intent rather than a state identifier: "in review" is not a
 * fact about a tracker but a decision about which of its states means that. */
export type TransitionIntent = 'started' | 'in_review' | 'done'

/** One position an issue could be moved to, as this tracker describes it. */
export interface TrackerStateOption {
  /** Provider-native identifier: a Linear state id. */
  readonly id: string
  readonly name: string
  /** Which intent this option satisfies, as the provider understands it. */
  readonly intent: TransitionIntent | null
  /** False when the tracker will not accept it from the issue's current status. */
  readonly available: boolean
}

/** A team an issue can be filed in. */
export interface TrackerTeam {
  readonly id: string
  /** The prefix of the team's issue keys, e.g. `TAV`. */
  readonly key: string
  readonly name: string
}

/** What `create` files. The description is markdown. */
export interface NewIssueInput {
  readonly teamId: string
  readonly title: string
  readonly description: string
  /** The user the issue is assigned to, found by email. Null leaves it unassigned. Set by the
   * service from the configured assignee, so callers never pass it. */
  readonly assigneeEmail?: string | null
}
