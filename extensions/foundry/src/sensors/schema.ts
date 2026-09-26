import * as path from 'node:path'
import { load } from 'js-yaml'
import { z } from 'zod'
import type { SensorDef, SensorSource } from './types.js'

// Sensors are YAML, resolved on the same three rungs as a recipe, role or
// rule (src/recipe/resolve.ts). See src/recipe/parse.ts for why hand-authored
// config is YAML rather than JSON: the comment is the point.
//
// Nothing here throws. A malformed file is reported by path and excluded, the
// same contract parseRecipe/parseRole/parseRule already keep.

export const SENSOR_SCHEMA_VERSION = 1

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string }

function fail(file: string, message: string): { ok: false; reason: string } {
  return { ok: false, reason: `${file}: ${message}` }
}

function idMatchesFile(id: string, file: string): boolean {
  return id === path.basename(file).replace(/\.ya?ml$/, '')
}

function checkVersion(value: unknown, file: string): { ok: false; reason: string } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(file, 'is not a mapping')
  }
  const declared = (value as { schemaVersion?: unknown }).schemaVersion
  if (typeof declared === 'number' && declared > SENSOR_SCHEMA_VERSION) {
    return fail(
      file,
      `declares schema version ${declared}; this build knows version ${SENSOR_SCHEMA_VERSION}`
    )
  }
  return null
}

const EVERY_PATTERN = /^([1-9][0-9]*)(m|h)$/

/** `<n>m` or `<n>h` to milliseconds. Throws on a string `EverySchema` refused. */
export function everyMs(every: string): number {
  const match = EVERY_PATTERN.exec(every)
  if (match === null) throw new Error(`not a valid interval: "${every}"`)
  const value = Number(match[1])
  const unit = match[2]
  return unit === 'h' ? value * 60 * 60 * 1000 : value * 60 * 1000
}

const FIVE_MINUTES_MS = 5 * 60 * 1000

const EverySchema = z
  .string()
  .refine((value) => EVERY_PATTERN.test(value), '`every` must look like `<n>m` or `<n>h`')
  .refine(
    (value) => !EVERY_PATTERN.test(value) || everyMs(value) >= FIVE_MINUTES_MS,
    '`every` must be at least 5m'
  )

const SourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('github-runs'),
    branch: z.string().nullable().default(null),
    limit: z.number().int().min(1).max(100),
  }),
  z.strictObject({
    kind: z.literal('github-issues'),
    label: z.string().min(1),
    limit: z.number().int().min(1).max(100),
  }),
  z.strictObject({
    kind: z.literal('tracker'),
    query: z.string().nullable().default(null),
    limit: z.number().int().min(1).max(100),
  }),
])

const SensorSchema = z.object({
  schemaVersion: z.number().int().default(SENSOR_SCHEMA_VERSION),
  id: z.string().min(1),
  description: z.string().default(''),
  every: EverySchema,
  severity: z.enum(['low', 'medium', 'high']),
  source: SourceSchema,
})

export function parseSensor(text: string, file: string): ParseResult<SensorDef> {
  let loaded: unknown
  try {
    loaded = load(text)
  } catch (error) {
    return fail(file, `could not be read as YAML — ${(error as Error).message}`)
  }
  const versionProblem = checkVersion(loaded, file)
  if (versionProblem !== null) return versionProblem

  const parsed = SensorSchema.safeParse(loaded)
  if (!parsed.success) return fail(file, parsed.error.issues.map((i) => i.message).join('; '))
  const sensor = parsed.data

  if (!idMatchesFile(sensor.id, file)) {
    return fail(file, `declares id "${sensor.id}", which does not match the filename`)
  }

  return {
    ok: true,
    value: {
      id: sensor.id,
      description: sensor.description,
      every: sensor.every,
      severity: sensor.severity,
      source: sensor.source as SensorSource,
    },
  }
}
