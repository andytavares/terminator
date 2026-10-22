import { defaultHintsDir, evaluateHints, loadHints, type HintTier } from '../profile/hints.js'
import { CHECK_NAMES, type CheckName } from './check-names.js'
import type { EntrySource } from '../profile/schema.js'

// What this project actually runs, discovered rather than assumed.
//
// This is the module that makes "works in any repository, with nothing
// installed into it" true instead of a claim. There is no hardcoded
// `npm run lint` anywhere downstream; the ladder executes what this found.
//
// Two rules it never breaks. It only reads — FR-070 forbids side effects in a
// target repository, and running an unfamiliar project's scripts during intake
// is exactly the surprise this design exists to avoid. And a command it cannot
// find is `null`, never a guess: `null` is what makes "not measured" reachable,
// and a check that reports a pass it did not earn is the failure mode that
// makes an unattended factory dangerous.

/** The legacy four are what an order written before profiles recorded; they read back as `hint`. */
type ProbeSource = 'package.json' | 'config' | 'makefile' | 'ci' | EntrySource

interface ProbedCommand {
  readonly command: string
  readonly source: ProbeSource
}

export type Toolchain = Record<CheckName, ProbedCommand | null>

/** The name the probe has always given each kind of evidence. */
const SOURCE_OF_TIER: Record<HintTier, ProbeSource> = {
  scripts: 'package.json',
  tools: 'config',
  targets: 'makefile',
  ciRuns: 'ci',
}

/**
 * The commands this project actually uses, or null where it has none.
 *
 * Reads only. Executes nothing. Writes nothing.
 */
export function probeToolchain(repoPath: string, hintsDir: string = defaultHintsDir()): Toolchain {
  const { checks } = evaluateHints(repoPath, loadHints(hintsDir).hints)
  const out = {} as Toolchain
  for (const check of CHECK_NAMES) {
    const found = checks[check]
    out[check] =
      found === null ? null : { command: found.command, source: SOURCE_OF_TIER[found.tier] }
  }
  return out
}

/** The checks this project cannot run, so the operator learns before work starts. */
export function unavailableChecks(toolchain: Toolchain): CheckName[] {
  return CHECK_NAMES.filter((name) => toolchain[name] === null)
}

/** How to install exactly what the lockfile pins, or null when there is no lockfile. */
export function installCommandFor(
  repo: string,
  hintsDir: string = defaultHintsDir()
): string | null {
  return evaluateHints(repo, loadHints(hintsDir).hints).prepare?.command ?? null
}
