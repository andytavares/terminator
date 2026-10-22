import type { WorkOrder } from '../order/schema.js'
import type { ResolvedProfile } from '../profile/resolve.js'
import type { Entry } from '../profile/schema.js'
import type { CheckName } from '../verify/check-names.js'
import type { Rung } from '../verify/ladder.js'
import { globPattern } from '../profile/glob.js'

// The Checks step as data. A command nobody has run is "Not yet run"; a missing one
// is "None" and reports "not measured" — neither is ever a pass.

/** What `foundry:profile-read` answers: the resolved profile and the proof stored with it. */
export interface ProfileFacts extends ResolvedProfile {
  readonly repository: string
  /** Parts the operator took the command away from: check names, 'prepare' or 'pictures'. */
  readonly removed?: readonly string[]
  readonly proof: {
    readonly commit: string
    readonly at?: string
    readonly exitCodes: Readonly<Record<string, number | null>>
  } | null
}

/** Which part of the profile a row edits. */
export type CheckTarget =
  | { readonly kind: 'prepare' }
  | { readonly kind: 'pictures' }
  | { readonly kind: 'check'; readonly name: CheckName }
  | { readonly kind: 'additional'; readonly name: string }

export type CheckState = 'passed' | 'failing' | 'untried' | 'missing' | 'notNeeded'

export interface CheckRowView {
  readonly key: string
  readonly label: string
  readonly command: string | null
  readonly source: string
  readonly proofWord: string
  readonly state: CheckState
  readonly target: CheckTarget
  /** True once the operator owns the command, so a failure on main is theirs to decide. */
  readonly yours: boolean
  /** True when the operator took away the command Foundry found. */
  readonly removed: boolean
}

const CHECK_LABELS: Record<CheckName, string> = {
  format: 'Format',
  lint: 'Lint',
  test: 'Tests',
  coverage: 'Coverage',
  e2e: 'End-to-end',
  build: 'Build',
}

/** The order the rendering lists the six checks in. */
const CHECK_ORDER: readonly CheckName[] = ['format', 'lint', 'test', 'coverage', 'e2e', 'build']

/** Which group of checks an added check runs with, in words. */
export const RUNG_GROUPS: readonly { readonly rung: Rung; readonly words: string }[] = [
  { rung: 'L0', words: 'with Format and Lint' },
  { rung: 'L1', words: 'with Tests' },
  { rung: 'L5', words: 'with Build' },
]

const REMOVED_WORDS = 'You removed the one Foundry found'

function groupWords(rung: Rung): string {
  return RUNG_GROUPS.find((group) => group.rung === rung)?.words ?? 'with Tests'
}

const SOURCE_WORDS: Record<Entry['source'], (evidence: string | undefined) => string> = {
  operator: () => 'You set this',
  repository: () => "Set in the repository's own profile",
  scout: (evidence) => (evidence ? `Read by the scout from ${evidence}` : 'Read by the scout'),
  hint: (evidence) =>
    evidence ? `Suggested by ${evidence}` : "Suggested by the repository's files",
}

/** Where a command came from, in words an operator would say. */
export function sourceInWords(entry: Pick<Entry, 'source' | 'evidence'>): string {
  return SOURCE_WORDS[entry.source](entry.evidence)
}

function proofPillOf(command: string, exitCodes: ProfileFacts['proof'], base: string) {
  const known = exitCodes !== null && command in exitCodes.exitCodes
  if (!known) return { word: 'Not yet run', state: 'untried' as const }
  const code = exitCodes.exitCodes[command]
  if (code === 0) return { word: `Exit 0 on ${base}`, state: 'passed' as const }
  return {
    word: code === null ? `Did not finish on ${base}` : `Exit ${code} on ${base}`,
    state: 'failing' as const,
  }
}

interface RowInput {
  readonly label: string
  readonly entry: Entry | null
  readonly target: CheckTarget
  readonly sourceNote?: string
}

const rowKey = (target: CheckTarget): string =>
  target.kind === 'check' || target.kind === 'additional'
    ? `${target.kind}:${target.name}`
    : target.kind

const partOf = (target: CheckTarget): string | null =>
  target.kind === 'additional' ? null : target.kind === 'check' ? target.name : target.kind

function rowOf(input: RowInput, profile: ProfileFacts, base: string): CheckRowView {
  const { label, entry, target, sourceNote } = input
  const key = rowKey(target)
  const part = partOf(target)
  const removed = part !== null && (profile.removed ?? []).includes(part)
  if (entry === null) {
    const source = removed ? REMOVED_WORDS : (sourceNote ?? 'Will report “not measured”')
    const none = { command: null, proofWord: 'None', state: 'missing' as const, yours: false }
    return { key, label, source, target, removed, ...none }
  }
  const proof = proofPillOf(entry.command, profile.proof, base)
  const source = sourceNote ?? sourceInWords(entry)
  const yours = entry.source === 'operator'
  const state = proof.state
  return {
    key,
    label,
    command: entry.command,
    source,
    proofWord: proof.word,
    state,
    target,
    yours,
    removed,
  }
}

function picturesRow(profile: ProfileFacts, base: string, interfaceChanged: boolean): CheckRowView {
  const row = rowOf(
    { label: 'Pictures', entry: profile.pictures, target: { kind: 'pictures' } },
    profile,
    base
  )
  if (profile.pictures !== null || interfaceChanged) return row
  const source = 'This order changes no interface, so none is needed'
  return { ...row, source, proofWord: 'Not needed', state: 'notNeeded' }
}

function additionalRows(profile: ProfileFacts, base: string): CheckRowView[] {
  return profile.additional.map((check) => {
    const entry: Entry = { command: check.command, source: check.source }
    const note = `${sourceInWords(entry)} · runs ${groupWords(check.rung)}`
    const target = { kind: 'additional', name: check.name } as const
    return rowOf({ label: check.name, entry, target, sourceNote: note }, profile, base)
  })
}

/** Every row of the Checks step, in the order the rendering shows. */
export function checkRows(
  profile: ProfileFacts,
  base: string,
  interfaceChanged: boolean
): CheckRowView[] {
  const named = CHECK_ORDER.map((name) =>
    rowOf(
      { label: CHECK_LABELS[name], entry: profile.checks[name], target: { kind: 'check', name } },
      profile,
      base
    )
  )
  return [
    rowOf(
      { label: 'Prepare the checkout', entry: profile.prepare, target: { kind: 'prepare' } },
      profile,
      base
    ),
    ...named,
    ...additionalRows(profile, base),
    picturesRow(profile, base, interfaceChanged),
  ]
}

/** Whether a row has a command to run. */
export const hasCommand = (row: CheckRowView): boolean => row.command !== null

/** A command that failed on main and is not yet the operator's to keep. */
export const failsOnMain = (row: CheckRowView): boolean => row.state === 'failing' && !row.yours

/** The six checks and the added ones: what a run measures, as against the checkout's setup and pictures. */
const measured = (rows: readonly CheckRowView[]): CheckRowView[] =>
  rows.filter((row) => row.target.kind !== 'pictures' && row.target.kind !== 'prepare')

/** Nothing measures this repository: no check, and no added check, has a command. */
export const nothingFound = (rows: readonly CheckRowView[]): boolean =>
  !measured(rows).some(hasCommand)

/** The rows waiting on the operator: failures on main, or one when nothing has a command. */
export function waitingOnYou(rows: readonly CheckRowView[]): number {
  return nothingFound(rows) ? 1 : rows.filter(failsOnMain).length
}

/** The measured checks that have no command, which will report "not measured". */
export const notMeasured = (rows: readonly CheckRowView[]): CheckRowView[] =>
  measured(rows).filter((row) => !hasCommand(row))

/** The commands that passed on main, out of those that have one. */
export function provenCounts(rows: readonly CheckRowView[]): { proven: number; total: number } {
  const commands = rows.filter(hasCommand)
  return {
    proven: commands.filter((row) => row.state === 'passed').length,
    total: rows.filter((row) => row.state !== 'notNeeded').length,
  }
}

/** A unit says it changes the interface, or touches a path the profile names as interface. */
export function interfaceTouched(order: WorkOrder, interfaceGlobs: readonly string[]): boolean {
  const patterns = interfaceGlobs.map(globPattern)
  return order.plan.units.some(
    (unit) =>
      unit.touchesInterface === true ||
      unit.touches.some((path) => patterns.some((pattern) => pattern.test(path)))
  )
}

/** What a save sends: the parts of the profile that change; the rest is left as it is. */
export interface SaveChange {
  readonly checks?: Partial<Record<CheckName, string | null>>
  readonly prepare?: string | null
  readonly pictures?: string | null
  readonly remove?: readonly string[]
  readonly additional?: readonly NewCheck[]
}

export interface NewCheck {
  readonly name: string
  readonly command: string
  readonly rung: Rung
}

const plainAdditional = (profile: ProfileFacts) =>
  profile.additional.map(({ name, command, rung }) => ({ name, command, rung }))

/** Setting a row's command, or clearing it with null, as the save the profile channel takes. */
export function changeFor(
  profile: ProfileFacts,
  target: CheckTarget,
  command: string | null
): SaveChange {
  if (target.kind === 'prepare') return { prepare: command }
  if (target.kind === 'pictures') return { pictures: command }
  if (target.kind === 'check') return { checks: { [target.name]: command } }
  const plain = plainAdditional(profile)
  if (command === null) return { additional: plain.filter((check) => check.name !== target.name) }
  return {
    additional: plain.map((check) => (check.name === target.name ? { ...check, command } : check)),
  }
}

/** Another check added to the profile, alongside the ones already there. */
export function addedCheckChange(profile: ProfileFacts, check: NewCheck): SaveChange {
  return { additional: [...plainAdditional(profile), check] }
}

/** Taking a row's command away: an operator's or an added one is dropped, any other is overruled. */
export function removeChange(profile: ProfileFacts, row: CheckRowView): SaveChange {
  const part = partOf(row.target)
  if (part === null || row.yours) return changeFor(profile, row.target, null)
  return { remove: [part] }
}
