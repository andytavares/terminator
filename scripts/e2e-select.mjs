#!/usr/bin/env node
// Chooses which tests/e2e/*.spec.ts files a diff needs. See
// docs/research/e2e-deterministic-selective.md, section "Selection".

import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')

// The specs that exercise cross-cutting extension-host behaviour (any
// extension can regress these), always pulled in alongside a narrower rule
// match. extension-settings writes every extension's settings; extension-escape
// leaves every extension; extension-smoke renders each one, in both themes, and
// checks that side-by-side controls line up.
export const EXTENSION_TRIO = [
  'extension-smoke.spec.ts',
  'extension-escape.spec.ts',
  'extension-settings.spec.ts',
]

// Path glob -> spec glob rules. A changed path matching a rule's globs
// pulls in that rule's specs. Spec entries may themselves be globs,
// expanded against the real spec list, so a split file (e.g.
// foundry.spec.ts -> foundry-intake.spec.ts) is picked up without a map
// edit.
export const IMPACT_MAP = [
  {
    globs: ['extensions/foundry/**'],
    specs: ['foundry*.spec.ts', ...EXTENSION_TRIO],
  },
  {
    globs: ['extensions/git-integration/**', 'tests/e2e/git-integration-contrast.entry.tsx'],
    specs: [
      'git-commit-flow.spec.ts',
      'git-integration-contrast.spec.ts',
      'git-integration-stacking.spec.ts',
      'git-status-watch.spec.ts',
      'home-contributions-setting.spec.ts',
      'merge-flow.spec.ts',
      'pr-review-*.spec.ts',
      'review-*.spec.ts',
      ...EXTENSION_TRIO,
    ],
  },
  {
    globs: ['extensions/notepad/**'],
    specs: ['notepad-*.spec.ts', 'quick-actions.spec.ts', ...EXTENSION_TRIO],
  },
  {
    globs: ['extensions/remote-control/**', 'src/renderer-remote/**'],
    specs: ['remote-control.spec.ts', ...EXTENSION_TRIO],
  },
  {
    globs: ['extensions/task-vault/**'],
    specs: ['task-vault-*.spec.ts', ...EXTENSION_TRIO],
  },
]

// A path matching one of these contributes nothing: it cannot affect any
// running app behaviour.
export const NONE_GLOBS = [
  'docs/**',
  'specs/**',
  '.specify/**',
  '**/*.md',
  'tests/unit/**',
  'tests/fixtures/**',
  'extensions/*/tests/**',
]

// A path matching one of these (or matching no rule at all - the
// fail-safe) forces the full suite.
export const ALL_GLOBS = [
  'src/**',
  'packages/**',
  'tests/e2e/helpers.ts',
  'tests/e2e/global-*.ts',
  'tests/e2e/fixtures/**',
  'playwright.config.ts',
  'package.json',
  'package-lock.json',
  'electron.vite.config.*',
  'scripts/build-extensions.cjs',
  '.github/workflows/ci.yml',
  'scripts/e2e-select.mjs',
]

// Always run whenever anything runs.
export const SMOKE_SPECS = ['extension-smoke.spec.ts', 'terminal.spec.ts', 'workspace.spec.ts']

// Specs that cover the core rather than one extension. A core change already
// selects everything, so these run only then; the list exists so a new spec
// has to be placed somewhere deliberately.
export const CORE_SPECS = [
  'app-menu.spec.ts',
  'branch-name.spec.ts',
  'core-ipc.spec.ts',
  'core-quick-actions.spec.ts',
  'design-system-fields.spec.ts',
  'desk.spec.ts',
  'extension-lifecycle.spec.ts',
  'home-tasks.spec.ts',
  'issue-trackers.spec.ts',
  'live-preview-spacing.spec.ts',
  'monitor-wall.spec.ts',
  'resume-session.spec.ts',
  'session-home.spec.ts',
  'session-surfaces.spec.ts',
  'settings.spec.ts',
  'sidebar-sorting.spec.ts',
  'terminal-breakout.spec.ts',
]

const SPEC_FILE_RE = /^tests\/e2e\/([^/]+\.spec\.ts)$/

// Converts a glob (single star, double star, double-star-slash) into an
// anchored RegExp. No dependency on `path.matchesGlob`.
function globToRegExp(glob) {
  let out = ''
  for (let i = 0; i < glob.length; ) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*' && glob[i + 2] === '/') {
      out += '(?:.*/)?'
      i += 3
    } else if (c === '*' && glob[i + 1] === '*') {
      out += '.*'
      i += 2
    } else if (c === '*') {
      out += '[^/]*'
      i += 1
    } else if ('.+^${}()|[]\\'.includes(c)) {
      out += '\\' + c
      i += 1
    } else {
      out += c
      i += 1
    }
  }
  return new RegExp('^' + out + '$')
}

export function matchesAny(value, globs) {
  return globs.some((g) => globToRegExp(g).test(value))
}

/**
 * Pure selection function.
 * @param {{ changed: string[], specs: string[], isMainPush: boolean }} args
 * @returns {{ mode: 'all' | 'none' | 'some', specs: string[] }}
 */
export function select({ changed, specs, isMainPush }) {
  if (isMainPush) return everySpec(specs)
  if (changed.length === 0) return { mode: 'none', specs: [] }

  const impact = specImpactOf(changed)
  if (impact.forceAll) return everySpec(specs)
  if (!impact.sawNonNonePath) return { mode: 'none', specs: [] }
  return { mode: 'some', specs: selectedSpecs(impact, specs) }
}

function everySpec(specs) {
  return { mode: 'all', specs: [...specs].sort() }
}

/** What the changed paths ask for: the whole suite, spec globs, or the spec files themselves. */
function specImpactOf(changed) {
  const impact = {
    forceAll: false,
    sawNonNonePath: false,
    specGlobs: new Set(),
    changedSpecFiles: new Set(),
  }
  for (const file of changed) addImpact(impact, file)
  return impact
}

function addImpact(impact, file) {
  const specFileMatch = SPEC_FILE_RE.exec(file)
  if (specFileMatch) {
    impact.changedSpecFiles.add(specFileMatch[1])
    impact.sawNonNonePath = true
    return
  }
  if (matchesAny(file, ALL_GLOBS)) {
    impact.forceAll = true
    impact.sawNonNonePath = true
    return
  }
  if (matchesAny(file, NONE_GLOBS)) return

  const rules = IMPACT_MAP.filter((rule) => matchesAny(file, rule.globs))
  for (const rule of rules) for (const specGlob of rule.specs) impact.specGlobs.add(specGlob)
  impact.sawNonNonePath = true
  // Matched by no rule at all: fail safe to the full suite.
  if (rules.length === 0) impact.forceAll = true
}

/** The specs the impact names, the changed spec files and the smoke set, among those that exist. */
function selectedSpecs({ specGlobs, changedSpecFiles }, specs) {
  const specSet = new Set(specs)
  const selected = new Set()
  for (const specGlob of specGlobs) {
    for (const spec of specs) {
      if (globToRegExp(specGlob).test(spec)) selected.add(spec)
    }
  }
  for (const spec of [...changedSpecFiles, ...SMOKE_SPECS]) {
    if (specSet.has(spec)) selected.add(spec)
  }
  return [...selected].sort()
}

export function computeChanged(base) {
  const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  return out.split('\n').filter(Boolean)
}

export function listSpecs() {
  return readdirSync(join(REPO_ROOT, 'tests/e2e'))
    .filter((f) => f.endsWith('.spec.ts'))
    .sort()
}

export function isMainPush(env = process.env) {
  return env.GITHUB_EVENT_NAME === 'push' && env.GITHUB_REF === 'refs/heads/main'
}

const isCli = import.meta.url === `file://${process.argv[1]}`
if (isCli) {
  const base = process.argv[2] || 'origin/main'
  const result = select({
    changed: computeChanged(base),
    specs: listSpecs(),
    isMainPush: isMainPush(process.env),
  })
  console.log(JSON.stringify(result))
}
