import { z } from 'zod'
import type { ChannelSpec } from '@terminator/extension-sdk'

import { environmentOf } from '../forge/intake-source.js'
import { baseBranchOfRepo } from '../forge/base-branch.js'
import { runOnFreshBase } from '../line/baseline.js'
import type { BaselineDeps } from '../line/baseline.js'
import { draftOrder } from '../order/draft.js'
import type { OrderStore } from '../order/store.js'
import { recordExitCodes } from '../profile/proof.js'
import { resolveProfile } from '../profile/resolve.js'
import { emptyProfile, type Entry, type Profile } from '../profile/schema.js'
import {
  deleteProfile,
  listProfiles,
  profileKey,
  readProfile,
  writeProfile,
} from '../profile/store.js'
import { CHECK_NAMES } from '../verify/check-names.js'
import { RUNGS } from '../verify/ladder.js'
import { foundryChannel } from './channel.js'

// A repository's profile, as the operator reads and edits it. Every entry the operator
// writes is `operator`, which outranks the repository's own file, the scout and the hints.

const RepoPayload = z.object({ repoPath: z.string().min(1) })

/** A command to set, or null to clear what the operator set; absent leaves it be. */
const OperatorCommand = z.string().trim().min(1).nullable().optional()

const SavePayload = RepoPayload.extend({
  checks: z
    .object(Object.fromEntries(CHECK_NAMES.map((name) => [name, OperatorCommand])))
    .optional(),
  prepare: OperatorCommand,
  pictures: OperatorCommand,
  additional: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        command: z.string().trim().min(1),
        rung: z.enum(RUNGS),
      })
    )
    .nullable()
    .optional(),
  share: z.array(z.string().min(1)).nullable().optional(),
  paths: z
    .object({
      interface: z.array(z.string()).optional(),
      manifests: z.array(z.string()).optional(),
      lockfiles: z.array(z.string()).optional(),
      formatting: z.array(z.string()).optional(),
    })
    .nullable()
    .optional(),
})
type SaveInput = z.infer<typeof SavePayload>

const ProvePayload = RepoPayload.extend({ command: z.string().trim().min(1) })
const NoPayload = z.strictObject({})

export interface ProfileChannelDeps {
  readonly dataRoot: () => string
  readonly hintsDir: string
  readonly store: OrderStore
  readonly baseline: () => BaselineDeps
}

export interface ProfileChannels {
  read(payload: z.infer<typeof RepoPayload>): Promise<unknown>
  save(payload: SaveInput): Promise<unknown>
  prove(payload: z.infer<typeof ProvePayload>): Promise<unknown>
  list(): Promise<unknown>
  forget(payload: z.infer<typeof RepoPayload>): Promise<unknown>
}

export function createProfileChannels(deps: ProfileChannelDeps): ProfileChannels {
  return {
    read: ({ repoPath }) => read(deps, repoPath),
    save: (payload) => save(deps, payload),
    prove: (payload) => prove(deps, payload),
    list: () => list(deps),
    forget: (payload) => forget(deps, payload.repoPath),
  }
}

async function resolvedFor(deps: ProfileChannelDeps, repoPath: string) {
  const stored = await readProfile(deps.dataRoot(), repoPath)
  return { stored, resolved: resolveProfile({ repoPath, hintsDir: deps.hintsDir, stored }) }
}

async function read(deps: ProfileChannelDeps, repoPath: string): Promise<unknown> {
  const { stored, resolved } = await resolvedFor(deps, repoPath)
  return { repository: repoPath, ...resolved, proof: stored?.proof ?? null }
}

/** What the operator's word does to an entry: sets it, clears it if theirs, or leaves it. */
function operatorEntry(current: Entry | null, change: string | null | undefined): Entry | null {
  if (change === undefined) return current
  if (change !== null) return { command: change, source: 'operator' }
  return current?.source === 'operator' ? null : current
}

function withOperatorChecks(
  checks: Profile['checks'],
  change: SaveInput['checks']
): Profile['checks'] {
  const next = { ...checks }
  for (const name of CHECK_NAMES) next[name] = operatorEntry(checks[name], change?.[name])
  return next
}

function withOperatorLists(stored: Profile, payload: SaveInput): Partial<Profile> {
  const { additional, share, paths } = payload
  return {
    additional:
      additional === undefined
        ? stored.additional
        : (additional ?? []).map((check) => ({ ...check, source: 'operator' as const })),
    share: share === undefined ? stored.share : (share ?? []),
    paths: paths === undefined ? stored.paths : { ...emptyProfile('').paths, ...paths },
  }
}

function operatorProfile(stored: Profile, payload: SaveInput): Profile {
  return {
    ...stored,
    ...withOperatorLists(stored, payload),
    checks: withOperatorChecks(stored.checks, payload.checks),
    prepare: operatorEntry(stored.prepare, payload.prepare),
    pictures: operatorEntry(stored.pictures, payload.pictures),
  }
}

async function save(deps: ProfileChannelDeps, payload: SaveInput): Promise<unknown> {
  const { repoPath } = payload
  const stored = (await readProfile(deps.dataRoot(), repoPath)) ?? emptyProfile(repoPath)
  await writeProfile(deps.dataRoot(), repoPath, operatorProfile(stored, payload))
  await seedDrafts(deps, repoPath)
  return read(deps, repoPath)
}

/** A draft order on this repository takes the profile as it now resolves; any other order keeps its own. */
async function seedDrafts(deps: ProfileChannelDeps, repoPath: string): Promise<void> {
  const { resolved } = await resolvedFor(deps, repoPath)
  const key = profileKey(repoPath)
  for (const order of await deps.store.list()) {
    const lead = [...order.context.repos].sort((a, b) => a.lane - b.lane)[0]
    if (order.status !== 'draft' || lead === undefined || profileKey(lead.path) !== key) continue
    const context = {
      ...order.context,
      toolchain: resolved.checks,
      environment: environmentOf(resolved),
    }
    await deps.store.save({ ...order, context })
  }
}

async function prove(
  deps: ProfileChannelDeps,
  { repoPath, command }: z.infer<typeof ProvePayload>
): Promise<unknown> {
  const baseline = deps.baseline()
  const order = draftOrder({
    id: `profile-${profileKey(repoPath)}`,
    title: 'Prove a command',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: [repoPath],
    baseBranches: [await baseBranchOfRepo(repoPath)],
    now: baseline.now(),
  })
  try {
    const run = await runOnFreshBase(order, baseline, [command])
    const exitCode = run.exitCodes[command] ?? null
    if (run.commit !== null) {
      const result = { commit: run.commit, at: baseline.now(), exitCodes: { [command]: exitCode } }
      await recordExitCodes(deps.dataRoot(), repoPath, result)
    }
    return { exitCode, logPath: run.logPaths[command] ?? null, commit: run.commit }
  } catch (error) {
    return { error: `Could not check out the base branch: ${(error as Error).message}` }
  }
}

function commandsIn(profile: Profile): number {
  const entries = [...Object.values(profile.checks), profile.prepare, profile.pictures]
  return entries.filter((entry) => entry !== null).length + profile.additional.length
}

async function list(deps: ProfileChannelDeps): Promise<unknown> {
  const profiles = await listProfiles(deps.dataRoot())
  return {
    profiles: profiles.map((profile) => ({
      repository: profile.repository,
      commands: commandsIn(profile),
      proofCommit: profile.proof?.commit ?? null,
      provedAt: profile.proof?.at ?? null,
    })),
  }
}

async function forget(deps: ProfileChannelDeps, repoPath: string): Promise<unknown> {
  await deleteProfile(deps.dataRoot(), repoPath)
  return { ok: true }
}

/** The profile surface's channels, each with the schema its payload is parsed with (ADR 096). */
export function profileChannelSpecs(channels: ProfileChannels): ChannelSpec[] {
  return [
    foundryChannel('foundry:profile-read', RepoPayload, channels.read),
    foundryChannel('foundry:profile-save', SavePayload, channels.save),
    foundryChannel('foundry:profile-prove', ProvePayload, channels.prove),
    foundryChannel('foundry:profiles-list', NoPayload, channels.list),
    foundryChannel('foundry:profile-forget', RepoPayload, channels.forget),
  ]
}
