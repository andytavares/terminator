import type {
  Issue,
  IssueSummary,
  MineSelector,
  TrackerAccount,
  TrackerId,
} from '../../../shared/types/index.js'

// One interface, two implementations.
//
// The facade above owns caching, single-flight and the error taxonomy; a
// provider owns exactly one tracker's wire protocol and nothing else. This is
// the boundary that keeps ADF, JQL and Linear's GraphQL out of every other
// file in the application.

/** Credentials as stored. Only a provider ever sees these. */
export type StoredCredential =
  | { tracker: 'linear'; apiKey: string }
  | { tracker: 'jira'; site: string; email: string; apiToken: string }

export interface VerifiedAccount extends TrackerAccount {
  /** Jira only — the site the credential belongs to. */
  site?: string
}

/**
 * Every provider holds these:
 *
 * 1. **Markdown out.** Whatever the tracker stores, `description` and every
 *    comment body leave the provider as markdown. Conversion happens here,
 *    once, not downstream.
 * 2. **Normalised state.** `state.type` is one of the five IssueStateType
 *    values; `state.name` is the tracker's own label, passed through.
 * 3. **Typed errors.** Every failure surfaces as a TrackerError. A raw HTTP
 *    status or SDK error never escapes.
 * 4. **Honour the stated wait.** A rate-limit refusal is raised as
 *    'rate-limited' carrying the tracker's own period. The facade waits it
 *    out; a provider never sleeps on its own.
 * 5. **No caching, no state.** Providers are functions over a credential.
 * 6. **No mutation beyond `comment` and `transition`.** A comment, and the
 *    issue's position in its own workflow. There is deliberately no way here
 *    to change an issue's assignee, title, labels, estimate or any other
 *    field, to create one or to delete one, and no implementation may add one
 *    — see provider.spec.ts, which tests the shape of this surface rather
 *    than trusting it.
 * 7. **Absent means null.** A field the tracker does not have is null or
 *    empty, never synthesised.
 */
export interface TrackerProvider {
  readonly id: TrackerId

  /** Prove a credential before it is stored. Throws TrackerError on rejection. */
  verify(cred: StoredCredential): Promise<VerifiedAccount>

  /** "My issues", per this tracker's own notion of mine. */
  listMine(cred: StoredCredential, mine: MineSelector, limit: number): Promise<IssueSummary[]>

  /** Full-text search. */
  search(cred: StoredCredential, term: string, limit: number): Promise<IssueSummary[]>

  /** One issue, fully populated. Null when it does not exist or is out of reach. */
  get(cred: StoredCredential, key: string): Promise<Issue | null>

  /** Post a comment. Rejects on failure; never swallows. */
  comment(cred: StoredCredential, key: string, body: string): Promise<void>

  /**
   * What this issue can be moved to, right now.
   *
   * Optional, and optional on purpose: a provider that cannot move an issue
   * omits both of these, and callers ask `IssueService.supportsTransitions`
   * rather than calling and catching. Required methods that throw would give
   * an interface claiming a capability half its implementations lack.
   *
   * Per-issue rather than per-project because a tracker's answer may depend
   * on the issue's current status. Linear's does not, and returns the team's
   * own states with `available: true` throughout.
   */
  states?(cred: StoredCredential, key: string): Promise<TrackerStateOption[]>

  /**
   * Move the issue.
   *
   * Resolves the intent against `states()` and applies it, unless `optionId`
   * names one of those options — the operator's own mapping, which is what
   * makes "which of my states means in review" their decision rather than
   * this file's guess.
   *
   * Rejects when nothing available satisfies the intent. The caller decides
   * whether that matters; for a workflow with no review state, it does not.
   */
  transition?(
    cred: StoredCredential,
    key: string,
    intent: TransitionIntent,
    optionId?: string
  ): Promise<void>
}

/**
 * The complete set of operations a provider may expose.
 *
 * Exported so the contract can be asserted in a test rather than merely
 * described in a comment. FR-034 and SC-014 say no field of an issue is ever
 * modified; 037's FR-059 carved out exactly one exception, the issue's own
 * workflow position. "We didn't write that method" is not something anything
 * checks, so provider.spec.ts checks it.
 */
export const PROVIDER_OPERATIONS = [
  'verify',
  'listMine',
  'search',
  'get',
  'comment',
  'states',
  'transition',
] as const

/**
 * The operations permitted to write to a tracker.
 *
 * Two, and the second is narrow by construction: `transition` moves an issue
 * along its own workflow and can do nothing else. It cannot set a field, and
 * an intent it cannot satisfy is refused rather than approximated.
 */
export const PROVIDER_WRITE_OPERATIONS = ['comment', 'transition'] as const

/**
 * The optional half of the surface.
 *
 * A provider is complete without these; `PROVIDER_OPERATIONS` is what a
 * provider *may* expose, not what it must.
 */
export const PROVIDER_OPTIONAL_OPERATIONS = ['states', 'transition'] as const

/**
 * The workflow positions an issue can be asked to move to.
 *
 * An intent rather than a state identifier because "in review" is not a fact
 * about a tracker — it is a decision about which of their states means that.
 * A `setState(stateId)` signature pushes that resolution onto every caller,
 * so every caller re-implements it.
 */
export type TransitionIntent = 'started' | 'in_review' | 'done'

/** Every intent, for a caller that needs to offer the operator all of them. */
export const TRANSITION_INTENTS: readonly TransitionIntent[] = ['started', 'in_review', 'done']

/** One position an issue could be moved to, as this tracker describes it. */
export interface TrackerStateOption {
  /** Provider-native identifier: a Linear state id, or a Jira transition id. */
  readonly id: string
  readonly name: string
  /** Which intent this option satisfies, as the provider understands it. */
  readonly intent: TransitionIntent | null
  /** False when the tracker will not accept it from the issue's current status. */
  readonly available: boolean
}
