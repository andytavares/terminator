import { useCallback, useState } from 'react'
import { foundryInvoke } from '../renderer/foundry-invoke.js'
import type { Baseline } from '../line/baseline.js'
import type { WorkOrder } from '../order/schema.js'
import {
  changeFor,
  removeChange,
  checkRows,
  interfaceTouched,
  nothingFound,
  waitingOnYou,
  addedCheckChange,
  type CheckRowView,
  type CheckTarget,
  type NewCheck,
  type ProfileFacts,
  type SaveChange,
} from '../forge/checks-view.js'
import { leadRepo } from '../order/lead-repo.js'
import { foundryKey, foundryQueries, useFoundryQuery } from '../renderer/foundry-query.js'
import { recordUsage } from '@terminator/extension-sdk/renderer'

// The Checks step's state. The profile is read once and again when Foundry says a
// profile changed; the renderer never polls it.

/** A decision about what cannot be measured, kept for the order. */
export type Decision = 'unmeasured' | 'noPictures'

export interface Finished {
  readonly exitCode: number | null
  readonly logPath: string | null
  readonly commit: string | null
}

export type ProveOutcome = { readonly running: true } | Finished | { readonly error: string }

export type LogTail = { readonly tail: string } | { readonly error: string }

export interface ChecksModel {
  readonly profile: ProfileFacts | null
  readonly rows: readonly CheckRowView[]
  /** Undefined until the profile is read, so the rail does not claim a count it has not got. */
  readonly waiting: number | undefined
  readonly base: string
  readonly interfaceChanged: boolean
  readonly decided: readonly Decision[]
  /** The key of the row being edited, or 'new' for the form that adds a check. */
  readonly editing: string | null
  readonly edit: (key: string | null) => void
  /** Records the decision on the order's ledger; the view then answers it back. */
  readonly decide: (decision: Decision) => void
  readonly removeRow: (row: CheckRowView) => Promise<string | null>
  /** The last lines of a log, or why they cannot be shown. */
  readonly tailOf: (path: string) => Promise<LogTail>
  /** Saves a change to the profile; the reason it could not be saved, or null. */
  readonly save: (change: SaveChange) => Promise<string | null>
  readonly saveCommand: (target: CheckTarget, command: string | null) => Promise<string | null>
  readonly addCheck: (check: NewCheck) => Promise<string | null>
  readonly prove: (command: string) => Promise<ProveOutcome>
  /** Where the base branch check kept the log of a command, if it ran it. */
  readonly logOf: (command: string) => string | null
}

interface OrderFacts {
  readonly order: WorkOrder
  readonly environment?: {
    readonly baseline: Baseline | null
    readonly decisions?: { readonly continueUnmeasured: boolean; readonly declinePictures: boolean }
  }
}

const isProfile = (answer: unknown): answer is ProfileFacts =>
  typeof answer === 'object' && answer !== null && 'checks' in answer && 'additional' in answer

const errorOf = (answer: unknown): string | null =>
  typeof answer === 'object' && answer !== null && 'error' in answer
    ? String((answer as { error: unknown }).error)
    : null

/** What the ledger says the operator decided, as the list the step reads. */
function decidedFrom(facts: OrderFacts | null): Decision[] {
  const decisions = facts?.environment?.decisions
  return [
    ...(decisions?.continueUnmeasured ? (['unmeasured'] as const) : []),
    ...(decisions?.declinePictures ? (['noPictures'] as const) : []),
  ]
}

/** The profile of the order's first repository, read again when a profile changes. */
function useProfile(repoPath: string | null) {
  const { data } = useFoundryQuery({ key: ['profile', repoPath], kinds: ['profile'] }, async () => {
    if (repoPath === null) return null
    const answer = await foundryInvoke('foundry:profile-read', { repoPath })
    if (!isProfile(answer)) throw new Error(errorOf(answer) ?? 'The profile could not be read.')
    return answer
  })
  // A save answers with the profile as written; it is the newest read there is.
  const show = useCallback(
    (answer: unknown): void => {
      if (isProfile(answer)) foundryQueries.setQueryData(foundryKey(['profile', repoPath]), answer)
    },
    [repoPath]
  )
  return { profile: data ?? null, show }
}

function useProve(repoPath: string | null) {
  return useCallback(
    async (command: string): Promise<ProveOutcome> =>
      await foundryInvoke('foundry:profile-prove', { repoPath: repoPath ?? '', command }),
    [repoPath]
  )
}

type Save = (change: SaveChange) => Promise<string | null>

/** The saves a row's moves make, each building its change from the profile as it stands. */
function useProfileSaves(profile: ProfileFacts | null, save: Save) {
  const saveCommand = useCallback(
    (target: CheckTarget, command: string | null) =>
      profile === null ? Promise.resolve(null) : save(changeFor(profile, target, command)),
    [profile, save]
  )
  const addCheck = useCallback(
    (check: NewCheck) =>
      profile === null ? Promise.resolve(null) : save(addedCheckChange(profile, check)),
    [profile, save]
  )
  const removeRow = useCallback(
    (row: CheckRowView) =>
      profile === null ? Promise.resolve(null) : save(removeChange(profile, row)),
    [profile, save]
  )
  return { saveCommand, addCheck, removeRow }
}

function useProfileMoves(
  repoPath: string | null,
  profile: ProfileFacts | null,
  show: (a: unknown) => void
) {
  const save = useCallback(
    async (change: SaveChange): Promise<string | null> => {
      const answer = await foundryInvoke('foundry:profile-save', {
        repoPath: repoPath ?? '',
        ...change,
        remove: change.remove && [...change.remove],
        additional: change.additional && [...change.additional],
      })
      show(answer)
      const error = errorOf(answer)
      recordUsage('profile-edit', error === null ? {} : { failed: true })
      return error
    },
    [repoPath, show]
  )
  return { save, prove: useProve(repoPath), ...useProfileSaves(profile, save), tailOf }
}

const tailOf = async (path: string): Promise<LogTail> =>
  await foundryInvoke('foundry:log-tail', { path })

function logFinder(baseline: Baseline | null | undefined) {
  return (command: string): string | null => {
    const step = baseline?.steps.find((each) => each.command === command)
    return (step && baseline?.logs[step.name]) || null
  }
}

interface Figures {
  readonly base: string
  readonly interfaceChanged: boolean
  readonly rows: readonly CheckRowView[]
  readonly waiting: number | undefined
}

/** The rows, and how many wait on the operator, once the profile is read. */
function figuresOf(
  facts: OrderFacts | null,
  profile: ProfileFacts | null,
  accepted: boolean
): Figures {
  const base = (facts && leadRepo(facts.order)?.baseBranch) || 'main'
  if (facts === null || profile === null) {
    return { base, interfaceChanged: false, rows: [], waiting: undefined }
  }
  const interfaceChanged = interfaceTouched(facts.order, profile.paths.interface)
  const rows = checkRows(profile, base, interfaceChanged)
  return {
    base,
    interfaceChanged,
    rows,
    waiting: accepted && nothingFound(rows) ? 0 : waitingOnYou(rows),
  }
}

/** Everything the Checks step, the rail count and the hand-off row draw from. */
export function useChecks(facts: OrderFacts | null, record: (d: Decision) => void): ChecksModel {
  const repoPath = (facts && leadRepo(facts.order)?.path) || null
  const { profile, show } = useProfile(repoPath)
  const decided = decidedFrom(facts)
  const [editing, edit] = useState<string | null>(null)
  const moves = useProfileMoves(repoPath, profile, show)
  const figures = figuresOf(facts, profile, decided.includes('unmeasured'))
  return {
    profile,
    ...figures,
    editing,
    edit,
    decided,
    decide: record,
    ...moves,
    logOf: logFinder(facts?.environment?.baseline),
  }
}
