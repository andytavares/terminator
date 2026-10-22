import * as fs from 'node:fs'
import * as path from 'node:path'

import { CHECK_NAMES, type CheckName } from '../verify/check-names.js'
import { checkVersion, loadYaml } from '../recipe/yaml-file.js'
import { evaluateHints, loadHints, type HintProposal } from './hints.js'
import {
  ProfileSchema,
  type AdditionalCheck,
  type Entry,
  type StoredEntry,
  isRemoved,
  type EntrySource,
  type Profile,
  type ProfilePaths,
  SCHEMA_VERSION,
} from './schema.js'

// Which source answers for each part of a repository's profile. First wins:
// the operator's word, then the repository's own `.foundry/profile.yaml`, then
// what the scout proved, then what the shipped hints read off the files.

export interface ResolvedProfile {
  readonly prepare: Entry | null
  readonly share: readonly string[]
  readonly checks: Record<CheckName, Entry | null>
  readonly additional: readonly AdditionalCheck[]
  readonly pictures: Entry | null
  readonly paths: ProfilePaths
}

export interface ResolveInput {
  readonly repoPath: string
  readonly hintsDir: string
  readonly stored: Profile | null
}

/** `<repo>/.foundry/profile.yaml`, read only; absent or invalid reads as none. @internal */
export function readRepositoryProfile(repoPath: string): Profile | null {
  const file = path.join(repoPath, '.foundry', 'profile.yaml')
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const loaded = loadYaml(text, file)
  if (!loaded.ok || checkVersion(loaded.value, file, SCHEMA_VERSION) !== null) return null
  const parsed = ProfileSchema.safeParse(loaded.value)
  return parsed.success ? parsed.data : null
}

const asSource = (entry: StoredEntry | null, source: EntrySource): Entry | null =>
  entry === null || isRemoved(entry) ? null : { ...entry, source }

/** The entries a stored profile may answer with: the operator's and the scout's, by source. */
const storedEntry = (entry: StoredEntry | null, source: EntrySource): Entry | null =>
  entry !== null && !isRemoved(entry) && entry.source === source ? entry : null

const hintEntry = (proposal: HintProposal | null): Entry | null =>
  proposal === null
    ? null
    : { command: proposal.command, source: 'hint', evidence: proposal.evidence }

const firstOf = <T>(candidates: readonly (T | null)[]): T | null =>
  candidates.find((candidate) => candidate !== null) ?? null

interface Layers {
  readonly stored: Profile | null
  readonly repository: Profile | null
  readonly hinted: ReturnType<typeof evaluateHints>
}

function entryFrom(
  layers: Layers,
  pick: (profile: Profile) => StoredEntry | null,
  hint: Entry | null
) {
  const { stored, repository } = layers
  if (stored !== null && isRemoved(pick(stored))) return null
  return firstOf([
    stored === null ? null : storedEntry(pick(stored), 'operator'),
    repository === null ? null : asSource(pick(repository), 'repository'),
    stored === null ? null : storedEntry(pick(stored), 'scout'),
    hint,
  ])
}

function pathsFrom({ stored, repository, hinted }: Layers): ProfilePaths {
  const given = (key: keyof ProfilePaths): readonly string[] =>
    firstOf(
      [stored?.paths[key], repository?.paths[key]].map((list) => (list?.length ? list : null))
    ) ?? hinted.paths[key]
  return {
    interface: [...given('interface')],
    manifests: [...given('manifests')],
    lockfiles: [...given('lockfiles')],
    formatting: [...given('formatting')],
  }
}

function additionalFrom({ stored, repository }: Layers): AdditionalCheck[] {
  const all = [
    ...(stored?.additional ?? []),
    ...(repository?.additional ?? []).map((check) => ({ ...check, source: 'repository' as const })),
  ]
  return all.filter((check, index) => all.findIndex((c) => c.name === check.name) === index)
}

function sharedFrom({ stored, repository, hinted }: Layers): string[] {
  return [
    ...(firstOf([stored?.share, repository?.share].map((l) => (l?.length ? l : null))) ??
      hinted.share),
  ]
}

export function resolveProfile({ repoPath, hintsDir, stored }: ResolveInput): ResolvedProfile {
  const hinted = evaluateHints(repoPath, loadHints(hintsDir).hints)
  const layers: Layers = { stored, repository: readRepositoryProfile(repoPath), hinted }
  const checks = {} as Record<CheckName, Entry | null>
  for (const check of CHECK_NAMES) {
    checks[check] = entryFrom(
      layers,
      (profile) => profile.checks[check],
      hintEntry(hinted.checks[check])
    )
  }
  return {
    prepare: entryFrom(layers, (profile) => profile.prepare, hintEntry(hinted.prepare)),
    share: sharedFrom(layers),
    checks,
    additional: additionalFrom(layers),
    pictures: entryFrom(layers, (profile) => profile.pictures, null),
    paths: pathsFrom(layers),
  }
}
