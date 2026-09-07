import type { LedgerEntry } from './append.js'
import type { Rung } from '../verify/ladder.js'

// The factory stops repeating what you reject.
//
// Nothing here runs on its own. There is no timer, no hook on the append path
// and no call from anywhere but the channel the operator's own button reaches
// — an assistant that volunteers rules is one whose rules get accepted without
// being read, and a rule accepted without being read is worse than no rule.
//
// A proposal is only ever an argument: here is what you rejected, three times,
// for the same reason, and here are the entries. The operator decides.

/** Actions that mean "the operator turned work away". */
export const REJECTION_ACTIONS = [
  'gate.decided',
  'verify.failed',
  'review.rejected',
  'assumption.struck',
  'inspection.finding',
] as const

/** Gate outcomes that are a rejection rather than an approval. */
const REJECTING_OPTIONS = ['send_back', 'skip', 'stop', 'accept_debt']

/** Three. Twice is a coincidence; a third time is a pattern worth a rule. */
export const REPETITION_THRESHOLD = 3

export interface Citation {
  /** `<timestamp>/<subject>` — the ledger is append-only, so this is stable. */
  readonly ref: string
  readonly at: string
  readonly actor: string
  readonly action: string
  readonly subject: string
  readonly reason: string
}

export interface Proposal {
  readonly id: string
  /** What the rule would assert, in the operator's own recurring words. */
  readonly asserts: string
  readonly rung: Rung
  /** `curator:<ref>,<ref>,…` — the entries this derives from, on the rule. */
  readonly origin: string
  readonly citations: readonly Citation[]
  readonly occurrences: number
}

/** A stable reference to one ledger line. */
export function citationRef(entry: LedgerEntry): string {
  return `${entry.at}/${entry.subject}`
}

function isRejection(entry: LedgerEntry): boolean {
  if (!(REJECTION_ACTIONS as readonly string[]).includes(entry.action)) return false
  if (entry.reason.trim() === '') return false
  if (entry.action !== 'gate.decided') return true
  // "risk.p0 -> approve" is not a rejection. Only the outcomes that send work
  // back or refuse it are.
  return REJECTING_OPTIONS.some((option) => entry.reason.includes(`-> ${option}`))
}

/**
 * The stated reason, with the specifics taken out.
 *
 * Two rejections of "U-4 hardcodes the timeout" and "U-9 hardcodes the
 * timeout" are the same complaint; the unit id is what differs and it is
 * exactly what must not. Digits, identifiers and paths go; the words stay.
 */
export function normaliseReason(reason: string): string {
  return reason
    .toLowerCase()
    .replace(/`[^`]*`/g, ' ')
    .replace(/\b[a-z]+-\d+\b/g, ' ')
    .replace(/\b[\w./-]*[./][\w./-]*\b/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A readable id from the normalised words. Bounded, so a filename stays sane. */
function slugFor(normalised: string): string {
  const words = normalised
    .split(' ')
    .filter((word) => word.length > 2)
    .slice(0, 5)
  return words.length === 0 ? 'repeated-rejection' : words.join('-')
}

/**
 * Which rung a proposed rule belongs on.
 *
 * Derived from what the rejections were about rather than asked: a complaint
 * about a test is a rung the ladder already has, and asking the operator to
 * pick one would be asking them to learn the ladder to accept one rule.
 */
function rungFor(normalised: string): Rung {
  if (/\btest|coverage|spec\b/.test(normalised)) return 'L2'
  if (/\bsecurity|secret|credential|token|auth\b/.test(normalised)) return 'L5'
  if (/\blint|format|style|icon\b/.test(normalised)) return 'L1'
  if (/\bdoc|readme|adr\b/.test(normalised)) return 'L6'
  return 'L3'
}

export interface ProposeInput {
  readonly entries: readonly LedgerEntry[]
  /** Rules already in force, so nothing already covered is proposed again. */
  readonly existingRuleIds?: readonly string[]
  /** Proposals the operator has already turned down. Never offered twice. */
  readonly rejectedIds?: readonly string[]
  readonly threshold?: number
}

/**
 * What the ledger says you keep rejecting.
 *
 * Called only when the operator asks (FR-076). Returns nothing rather than
 * something weak: below the threshold there is no pattern, and a proposal
 * built from two entries is a guess wearing a citation.
 */
export function propose(input: ProposeInput): Proposal[] {
  const threshold = input.threshold ?? REPETITION_THRESHOLD
  const already = new Set([...(input.existingRuleIds ?? []), ...(input.rejectedIds ?? [])])

  const groups = new Map<string, LedgerEntry[]>()
  for (const entry of input.entries) {
    if (!isRejection(entry)) continue
    const key = normaliseReason(entry.reason)
    if (key === '') continue
    groups.set(key, [...(groups.get(key) ?? []), entry])
  }

  const proposals: Proposal[] = []
  for (const [normalised, entries] of groups) {
    if (entries.length < threshold) continue
    const id = `curator-${slugFor(normalised)}`
    if (already.has(id)) continue

    const citations = entries.map((entry) => ({
      ref: citationRef(entry),
      at: entry.at,
      actor: entry.actor,
      action: entry.action,
      subject: entry.subject,
      reason: entry.reason,
    }))

    proposals.push({
      id,
      // The operator's own most recent words, not a paraphrase — a rule they
      // do not recognise is one they cannot judge.
      asserts: entries[entries.length - 1].reason.trim(),
      rung: rungFor(normalised),
      origin: `curator:${citations.map((c) => c.ref).join(',')}`,
      citations,
      occurrences: entries.length,
    })
  }

  // Most-repeated first: the strongest argument goes at the top.
  return proposals.sort((a, b) => b.occurrences - a.occurrences || a.id.localeCompare(b.id))
}
