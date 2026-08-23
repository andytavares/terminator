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
 * 6. **No mutation beyond `comment`.** There is deliberately no way here to
 *    change an issue's state, assignee or any other field, and no
 *    implementation may add one — see provider.spec.ts, which tests the shape
 *    of this surface rather than trusting it.
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
}

/**
 * The complete set of operations a provider may expose.
 *
 * Exported so the contract can be asserted in a test rather than merely
 * described in a comment: FR-034 and SC-014 say no field of an issue is ever
 * modified, and "we didn't write that method" is not something anything
 * checks.
 */
export const PROVIDER_OPERATIONS = ['verify', 'listMine', 'search', 'get', 'comment'] as const

/** The only operation permitted to write to a tracker. */
export const PROVIDER_WRITE_OPERATIONS = ['comment'] as const
