import { readFileSync } from 'node:fs'
import * as path from 'node:path'

// What self-review runs, and how each step's result gets recorded.
//
// The four checks used to be one `&&` chain: a single exit code for four
// questions, and everything after the first failure never ran. So the gate
// could say "something failed" and nothing else, and its quality table — which
// wants a pass/fail and a number per check — had no source at all.
//
// Now each step runs whether or not the one before it passed, and each records
// its own exit code. Where a tool can report its findings as data, it is asked
// to: eslint's `json` formatter and vitest's `json-summary` coverage reporter
// are both documented output contracts, which is a different thing from
// scraping numbers out of console text.

/** Where a step's exit code lands, relative to the output directory. */
export const CODE_SUFFIX = '.code'

export const LINT_REPORT = 'lint.json'
export const COVERAGE_DIR = 'coverage'

export type StepId = 'format' | 'lint' | 'test' | 'review'

export interface SelfReviewStep {
  readonly id: StepId
  readonly command: string
}

export interface SelfReviewPlanOptions {
  /** The repository the review runs in — its scripts decide what can be run. */
  readonly worktreePath: string
  /** Where exit codes and machine-readable reports are written. */
  readonly outputDir: string
  /** The read-only settings for the review step; null when they could not be written. */
  readonly settingsPath: string | null
}

function scriptsOf(worktreePath: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(path.join(worktreePath, 'package.json'), 'utf8')
    )
    if (typeof parsed !== 'object' || parsed === null) return {}
    const scripts = (parsed as { scripts?: unknown }).scripts
    return typeof scripts === 'object' && scripts !== null
      ? (scripts as Record<string, unknown>)
      : {}
  } catch {
    // No package.json, or unreadable. Each step below says so for itself.
    return {}
  }
}

function has(scripts: Record<string, unknown>, name: string): boolean {
  return typeof scripts[name] === 'string'
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

/** A step that does nothing and says why, so "not run" never reads as "passed". */
function skipped(reason: string): string {
  return `echo ${shellQuote(`⚠ ${reason}`)} && false`
}

export function selfReviewSteps(options: SelfReviewPlanOptions): SelfReviewStep[] {
  const scripts = scriptsOf(options.worktreePath)
  const lintReport = path.join(options.outputDir, LINT_REPORT)
  const coverageDir = path.join(options.outputDir, COVERAGE_DIR)

  return [
    {
      id: 'format',
      // Never `format`: that is `prettier --write` wherever both exist, and a
      // review that reformats the code under review is not a review.
      command: has(scripts, 'format:check')
        ? 'npm run format:check'
        : skipped('formatting not checked: this repository defines no format:check script'),
    },
    {
      id: 'lint',
      // `--format json --output-file`: a documented report shape, written even
      // when there is nothing to report, rather than counts read off the
      // console.
      command: has(scripts, 'lint')
        ? `npm run lint -- --format json --output-file ${shellQuote(lintReport)}`
        : skipped('linting not run: this repository defines no lint script'),
    },
    {
      id: 'test',
      // Coverage reported as data, and written outside the repository: a review
      // must not add a `coverage/` directory to the diff it is reviewing.
      command: `npx vitest run --coverage --coverage.reporter=json-summary --coverage.reportsDirectory=${shellQuote(coverageDir)}`,
    },
    {
      id: 'review',
      command:
        options.settingsPath === null
          ? // Refused rather than silently falling back to bypassing
            // permissions, which is how this was wrong before.
            skipped('review skipped: the read-only policy could not be installed')
          : `claude --print --settings ${shellQuote(options.settingsPath)} --permission-mode default --strict-mcp-config /google-review`,
    },
  ]
}

/**
 * The whole thing as one shell command.
 *
 * Sequential and deliberately not short-circuiting: for a gate you want all
 * four answers, not the first failure. Each step's status is written to its own
 * file, because one exit code cannot carry four results — and the shell's
 * `$?` is read immediately, before anything else can overwrite it.
 *
 * Output is left streaming to the console rather than captured per step: the
 * operator watches this run, and a pipe to `tee` would have to read
 * `PIPESTATUS`, which is not the same variable in bash and zsh.
 */
export function selfReviewCommand(options: SelfReviewPlanOptions): string {
  const steps = selfReviewSteps(options)
  const parts = [`mkdir -p ${shellQuote(options.outputDir)}`]
  for (const step of steps) {
    const codeFile = shellQuote(path.join(options.outputDir, `${step.id}${CODE_SUFFIX}`))
    parts.push(`${step.command}; echo $? > ${codeFile}`)
  }
  return parts.join('; ')
}
