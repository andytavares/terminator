import { z } from 'zod'
import { CHECK_NAMES, type CheckName } from '../verify/check-names.js'
import { RUNGS } from '../verify/ladder.js'

// What Foundry knows about one repository's toolchain, owned by the operator.
// The same shape is read from `<repo>/.foundry/profile.yaml` (read only) and
// stored under the data root; every field defaults so a short file parses.

export const SCHEMA_VERSION = 1

export const ENTRY_SOURCES = ['operator', 'repository', 'scout', 'hint'] as const
export type EntrySource = (typeof ENTRY_SOURCES)[number]

export const EntrySchema = z.object({
  command: z.string().min(1),
  source: z.enum(ENTRY_SOURCES),
  /** The file the command was read from, where there is one. */
  evidence: z.string().optional(),
})
export type Entry = z.infer<typeof EntrySchema>

const AdditionalCheckSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  rung: z.enum(RUNGS),
  source: z.enum(ENTRY_SOURCES),
})
export type AdditionalCheck = z.infer<typeof AdditionalCheckSchema>

const nullableEntry = EntrySchema.nullable().default(null)

export const ChecksSchema = z.object(
  Object.fromEntries(CHECK_NAMES.map((name) => [name, nullableEntry])) as Record<
    CheckName,
    typeof nullableEntry
  >
)

export const PathsSchema = z.object({
  interface: z.array(z.string()).default([]),
  manifests: z.array(z.string()).default([]),
  lockfiles: z.array(z.string()).default([]),
})
export type ProfilePaths = z.infer<typeof PathsSchema>

const ProofSchema = z.object({
  commit: z.string(),
  exitCodes: z.record(z.number().nullable()),
})

export const ProfileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  /** For display only: the repository this profile describes. */
  repository: z.string().default(''),
  prepare: nullableEntry,
  share: z.array(z.string()).default([]),
  checks: ChecksSchema.default({}),
  additional: z.array(AdditionalCheckSchema).default([]),
  pictures: nullableEntry,
  paths: PathsSchema.default({}),
  proof: ProofSchema.nullable().default(null),
})
export type Profile = z.infer<typeof ProfileSchema>

export function emptyProfile(repository: string): Profile {
  return ProfileSchema.parse({ repository })
}
