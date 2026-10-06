#!/usr/bin/env node
// Chooses which tests/e2e/*.spec.ts files a diff needs. See
// docs/research/e2e-deterministic-selective.md, section "Selection".

import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')

// The four specs that exercise cross-cutting extension-host behaviour
// (any extension can regress these), always pulled in alongside a
// narrower rule match.
export const EXTENSION_TRIO = [
  'extension-smoke.spec.ts',
  'extension-keyboard.spec.ts',
  'extension-themes.spec.ts',
  'extension-escape.spec.ts',
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
      'git-sidebar.spec.ts',
      'git-integration-smoke.spec.ts',
      'git-integration-contrast.spec.ts',
      'merge-flow.spec.ts',
      ...EXTENSION_TRIO,
    ],
  },
  {
    globs: ['extensions/notepad/**'],
    specs: [
      'notepad-outline.spec.ts',
      'dismiss-surface-on-click.spec.ts',
      'extension-escape-exit.spec.ts',
      'quick-actions.spec.ts',
      ...EXTENSION_TRIO,
    ],
  },
  {
    globs: ['extensions/remote-control/**', 'src/renderer-remote/**'],
    specs: ['remote-app.spec.ts', ...EXTENSION_TRIO],
  },
  {
    globs: ['extensions/task-vault/**'],
    specs: [...EXTENSION_TRIO],
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
  'branch-name.spec.ts',
  'close-session.spec.ts',
  'extension.spec.ts',
  'monitor-wall.spec.ts',
  'open-in-editor.spec.ts',
  'project.spec.ts',
  'resume-session.spec.ts',
  'session-home.spec.ts',
  'session-surfaces.spec.ts',
  'settings.spec.ts',
  'sidebar-alignment.spec.ts',
  'sidebar-branch-first.spec.ts',
  'sidebar-sorting.spec.ts',
  'split-panes.spec.ts',
  'terminal-missing-folder.spec.ts',
  'terminal-right-edge.spec.ts',
  'terminal-scroll.spec.ts',
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

function matchesAny(value, globs) {
  return globs.some((g) => globToRegExp(g).test(value))
}

/**
 * Pure selection function.
 * @param {{ changed: string[], specs: string[], isMainPush: boolean }} args
 * @returns {{ mode: 'all' | 'none' | 'some', specs: string[] }}
 */
export function select({ changed, specs, isMainPush }) {
  const specSet = new Set(specs)

  if (isMainPush) {
    return { mode: 'all', specs: [...specs].sort() }
  }

  if (changed.length === 0) {
    return { mode: 'none', specs: [] }
  }

  let forceAll = false
  let sawNonNonePath = false
  const matchedSpecGlobs = new Set()
  const changedSpecFiles = new Set()

  for (const file of changed) {
    const specFileMatch = SPEC_FILE_RE.exec(file)
    if (specFileMatch) {
      changedSpecFiles.add(specFileMatch[1])
      sawNonNonePath = true
      continue
    }

    if (matchesAny(file, ALL_GLOBS)) {
      forceAll = true
      sawNonNonePath = true
      continue
    }

    if (matchesAny(file, NONE_GLOBS)) {
      continue
    }

    let mapped = false
    for (const rule of IMPACT_MAP) {
      if (matchesAny(file, rule.globs)) {
        mapped = true
        for (const specGlob of rule.specs) matchedSpecGlobs.add(specGlob)
      }
    }

    if (mapped) {
      sawNonNonePath = true
    } else {
      // Matched by no rule at all: fail safe to the full suite.
      forceAll = true
      sawNonNonePath = true
    }
  }

  if (forceAll) {
    return { mode: 'all', specs: [...specs].sort() }
  }

  if (!sawNonNonePath) {
    return { mode: 'none', specs: [] }
  }

  const selected = new Set()
  for (const specGlob of matchedSpecGlobs) {
    for (const spec of specs) {
      if (globToRegExp(specGlob).test(spec)) selected.add(spec)
    }
  }
  for (const spec of changedSpecFiles) {
    if (specSet.has(spec)) selected.add(spec)
  }
  for (const spec of SMOKE_SPECS) {
    if (specSet.has(spec)) selected.add(spec)
  }

  return { mode: 'some', specs: [...selected].sort() }
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
