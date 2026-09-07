import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// Whether Claude Code will start at all, in a directory it has not seen.
//
// A new folder gets the workspace trust dialog, and the documentation is
// explicit that it "appears in interactive sessions only and is bypassed in
// non-interactive `claude -p` or SDK runs". Foundry runs interactively on
// purpose — an agent in a terminal you can go and type at is the whole design —
// so every launch meets that dialog and sits there waiting for a keypress
// nobody is there to make. The agent shows as running: the process is up, the
// register has it, the graph says `running`. It has simply never started.
//
// The documented way to grant it without a prompt is
// `projects["<path>"].hasTrustDialogAccepted` in `~/.claude.json`.
//
// **Keyed to the repository, not the worktree.** The documentation again:
// "Trust is keyed to the git repository root (or main checkout root in
// worktrees)". Trusting the worktree path would write an entry that does
// nothing.

interface ClaudeConfig {
  projects?: Record<string, Record<string, unknown>>
  [key: string]: unknown
}

export function claudeConfigPath(home = os.homedir()): string {
  return path.join(home, '.claude.json')
}

function read(file: string): ClaudeConfig | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as ClaudeConfig)
      : null
  } catch {
    // Absent, or something this has no business rewriting.
    return null
  }
}

/** Whether this repository is already trusted. */
export function isTrusted(repoRoot: string, home = os.homedir()): boolean {
  const config = read(claudeConfigPath(home))
  return config?.projects?.[repoRoot]?.hasTrustDialogAccepted === true
}

export type TrustResult =
  | { changed: true }
  | { changed: false; reason: 'already trusted' | 'no config to amend' | 'could not write' }

/**
 * Trust the repository an agent is about to work in.
 *
 * Additive and narrow: it sets one boolean on one project entry and touches
 * nothing else. It never creates `~/.claude.json` — a machine with no Claude
 * Code configuration at all is one where a run was never going to work, and
 * inventing the operator's config file is not this extension's business.
 *
 * Written through a temporary file and renamed, because Claude Code rewrites
 * this file too and a half-written config is worse than an untrusted one.
 */
export function ensureTrusted(repoRoot: string, home = os.homedir()): TrustResult {
  if (repoRoot.trim() === '') return { changed: false, reason: 'no config to amend' }
  const file = claudeConfigPath(home)
  const config = read(file)
  if (config === null) return { changed: false, reason: 'no config to amend' }

  const projects = config.projects ?? {}
  const existing = projects[repoRoot] ?? {}
  if (existing.hasTrustDialogAccepted === true) {
    return { changed: false, reason: 'already trusted' }
  }

  const next: ClaudeConfig = {
    ...config,
    projects: { ...projects, [repoRoot]: { ...existing, hasTrustDialogAccepted: true } },
  }

  const temporary = `${file}.foundry-${process.pid}.tmp`
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(temporary, file)
    return { changed: true }
  } catch {
    try {
      fs.unlinkSync(temporary)
    } catch {
      // Nothing to clean up.
    }
    return { changed: false, reason: 'could not write' }
  }
}
