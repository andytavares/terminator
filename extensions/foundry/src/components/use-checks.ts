import { useCallback, useState } from 'react'
import { invoke } from '@terminator/extension-sdk/renderer'
import type { Baseline } from '../line/baseline.js'
import type { WorkOrder } from '../order/schema.js'
import {
  changeFor,
  checkRows,
  interfaceTouched,
  nothingFound,
  waitingOnYou,
  withAdditional,
  type CheckRowView,
  type CheckTarget,
  type NewCheck,
  type ProfileFacts,
  type SaveChange,
} from '../forge/checks-view.js'
import { usePushed } from '../renderer/use-pushed.js'

// The Checks step's state: the repository's profile as Foundry resolves it, the
// row being edited, and the two decisions an operator can make about what
// cannot be measured. The profile is read once and again when Foundry says a
// profile changed; the renderer never polls it.

/** A decision about what cannot be measured, kept for the order. */
export type Decision = 'unmeasured' | 'noPictures'

export interface Finished {
  readonly exitCode: number | null
  readonly logPath: string | null
  readonly commit: string | null
}

export type ProveOutcome = { readonly running: true } | Finished | { readonly error: string }

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
  readonly decide: (decision: Decision) => void
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
  readonly environment?: { readonly baseline: Baseline | null }
}

const isProfile = (answer: unknown): answer is ProfileFacts =>
  typeof answer === 'object' && answer !== null && 'checks' in answer && 'additional' in answer

const errorOf = (answer: unknown): string | null =>
  typeof answer === 'object' && answer !== null && 'error' in answer
    ? String((answer as { error: unknown }).error)
    : null

function leadRepo(order: WorkOrder) {
  return [...order.context.repos].sort((a, b) => a.lane - b.lane)[0]
}

function storedDecisions(key: string): Decision[] {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? '[]') as Decision[]
  } catch {
    return []
  }
}

/** Decisions live in this browser: the order has no record to keep them in. */
function useDecisions(orderId: string | null) {
  const key = `foundry.checks.${orderId}`
  const [chosen, setChosen] = useState<{ key: string; decided: Decision[] } | null>(null)
  const decided = chosen?.key === key ? chosen.decided : storedDecisions(key)
  const decide = useCallback(
    (decision: Decision) => {
      const next = [...decided.filter((each) => each !== decision), decision]
      setChosen({ key, decided: next })
      try {
        window.localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // Private windows refuse storage; the decision then lasts until the view closes.
      }
    },
    [decided, key]
  )
  return { decided, decide }
}

/** The profile of the order's first repository, read again when a profile changes. */
function useProfile(repoPath: string | null) {
  const [profile, setProfile] = useState<ProfileFacts | null>(null)
  const read = useCallback(
    async (): Promise<unknown> =>
      repoPath === null ? null : invoke('foundry:profile-read', { repoPath }),
    [repoPath]
  )
  const show = useCallback((answer: unknown) => {
    if (isProfile(answer)) setProfile(answer)
  }, [])
  usePushed(read, show, { kinds: ['profile'] })
  return { profile, show }
}

function useProfileMoves(
  repoPath: string | null,
  profile: ProfileFacts | null,
  show: (a: unknown) => void
) {
  const save = useCallback(
    async (change: SaveChange): Promise<string | null> => {
      const answer = await invoke('foundry:profile-save', { repoPath, ...change })
      show(answer)
      return errorOf(answer)
    },
    [repoPath, show]
  )
  const prove = useCallback(
    async (command: string): Promise<ProveOutcome> =>
      (await invoke('foundry:profile-prove', { repoPath, command })) as ProveOutcome,
    [repoPath]
  )
  const saveCommand = useCallback(
    (target: CheckTarget, command: string | null) =>
      profile === null ? Promise.resolve(null) : save(changeFor(profile, target, command)),
    [profile, save]
  )
  const addCheck = useCallback(
    (check: NewCheck) =>
      profile === null ? Promise.resolve(null) : save(withAdditional(profile, check)),
    [profile, save]
  )
  return { save, prove, saveCommand, addCheck }
}

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
export function useChecks(facts: OrderFacts | null): ChecksModel {
  const repoPath = (facts && leadRepo(facts.order)?.path) || null
  const { profile, show } = useProfile(repoPath)
  const decisions = useDecisions(facts?.order.id ?? null)
  const [editing, edit] = useState<string | null>(null)
  const moves = useProfileMoves(repoPath, profile, show)
  const figures = figuresOf(facts, profile, decisions.decided.includes('unmeasured'))
  return {
    profile,
    ...figures,
    editing,
    edit,
    ...decisions,
    ...moves,
    logOf: logFinder(facts?.environment?.baseline),
  }
}
