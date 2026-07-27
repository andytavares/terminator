import { readFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'

// Per-repository settings, committed so they travel with the repository
// (FR-037). JSON rather than TOML: `JSON.parse` is stdlib and Zod already
// validates, so TOML would have meant a new dependency for no functional gain
// (research.md R5, task T007).
//
// Every key is optional. An absent file is valid and means "all defaults" —
// provisioning still works, it simply shares nothing, copies nothing, and runs
// no setup.

const CONFIG_RELATIVE_PATH = join('.terminator', 'config.json')

// `.prefault` rather than `.default` on every section: in Zod 4 a `.default()`
// value is returned as-is without being parsed, so an absent section would come
// back as a bare `{}` with none of its own key defaults applied.
const repoConfigSchema = z.object({
  worktree: z
    .object({
      symlink: z.array(z.string()).default([]),
      copy: z.array(z.string()).default([]),
      portBase: z.number().int().positive().default(4000),
      portSpan: z.number().int().positive().default(10),
    })
    .prefault({}),
  scripts: z
    .object({
      setup: z.string().optional(),
      teardown: z.string().optional(),
      verify: z.string().optional(),
    })
    .prefault({}),
  stall: z
    .object({
      silenceMs: z.number().int().positive().default(480_000),
      noProgressMs: z.number().int().positive().default(900_000),
    })
    .prefault({}),
  review: z
    .object({
      criticalPaths: z.array(z.string()).default([]),
      // What a branch is diffed against. `HEAD` would diff the branch with
      // itself and every review would look empty.
      baseBranch: z.string().min(1).default('main'),
      unattendedMergeLowestGrade: z.boolean().default(false),
    })
    .prefault({}),
  network: z
    .object({
      allowedHosts: z.array(z.string()).default([]),
    })
    .prefault({}),
})

export type RepoConfig = z.infer<typeof repoConfigSchema>

export const DEFAULT_REPO_CONFIG: RepoConfig = repoConfigSchema.parse({})

/**
 * Never throws. A repository with a broken config still provisions on defaults
 * rather than blocking every session in it — the failure the operator cares
 * about is a failing setup command, not a typo in a settings file.
 */
export function loadRepoConfig(repoPath: string): RepoConfig {
  let raw: string
  try {
    raw = readFileSync(join(repoPath, CONFIG_RELATIVE_PATH), 'utf-8')
  } catch {
    return DEFAULT_REPO_CONFIG
  }

  try {
    const parsed = repoConfigSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : DEFAULT_REPO_CONFIG
  } catch {
    return DEFAULT_REPO_CONFIG
  }
}
