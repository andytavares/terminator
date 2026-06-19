#!/usr/bin/env node
/**
 * Pre-commit patch coverage guard.
 * Checks that every staged non-test source file has ≥ 80% coverage
 * on all four metrics: lines, statements, branches, functions.
 * Exits 1 (blocking the commit) if any file is below threshold.
 */
'use strict'

const { execSync, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const THRESHOLD = 80
const COVERAGE_FILE = path.join(__dirname, '..', 'coverage', 'coverage-final.json')

// Glob patterns excluded from coverage in vitest.config.ts — files matching these
// are never instrumented and will never appear in coverage-final.json.
// Keep in sync with the `coverage.exclude` array in vitest.config.ts.
const COVERAGE_EXCLUDED_PATTERNS = [
  /src\/renderer\/index\.tsx$/,
  /src\/main\/index\.ts$/,
  /src\/main\/preload\.ts$/,
  /extensions\/[^/]+\/src\/index\.ts$/,
  /extensions\/[^/]+\/src\/renderer\.tsx$/,
  /extensions\/[^/]+\/src\/stores\//,
  /extensions\/[^/]+\/src\/components\//,
  /extensions\/[^/]+\/src\/mcp\/server\.ts$/,
  /extensions\/[^/]+\/src\/vault\/types\.ts$/,
  /extensions\/[^/]+\/src\/vault\/db\.ts$/,
  /extensions\/[^/]+\/src\/vault\/writer\.ts$/,
  /extensions\/[^/]+\/src\/schemas\/project\.schema\.ts$/,
  /extensions\/[^/]+\/src\/types\//, // pure TypeScript type declarations — no executable code
  /extensions\/[^/]+\/src\/providers\/adapter\.ts$/, // interface-only adapter contract
  /src\/shared\/types\//,
  /\.d\.ts$/,
  /vitest\.config\.ts$/, // test runner config, not application code
]

function isCoverageExcluded(filePath) {
  return COVERAGE_EXCLUDED_PATTERNS.some((re) => re.test(filePath))
}

function getStagedSourceFiles() {
  const out = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' })
  return out
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => {
      if (!f) return false
      // Only .ts/.tsx source files
      if (!/\.(ts|tsx)$/.test(f)) return false
      // Skip test files
      if (/\.(spec|test)\.(ts|tsx)$/.test(f)) return false
      // Skip test directories
      if (/\/(tests?|__tests?__)\//.test(f)) return false
      // Skip type declaration files
      if (/\.d\.ts$/.test(f)) return false
      // Skip files that vitest.config.ts excludes from coverage collection —
      // they will never appear in coverage-final.json regardless of test count.
      if (isCoverageExcluded(f)) return false
      return true
    })
}

function runCoverage() {
  console.log('Running coverage suite for patch coverage check...')

  // Run vitest directly (no shell pipeline) so we get the real exit code and
  // V8 coverage flushes cleanly on process exit.  Output goes to the terminal
  // in real-time via stdio: 'inherit' so the developer can see progress.
  const result = spawnSync(
    'npx',
    ['vitest', 'run', '--coverage', '--coverage.reporter=json', '--coverage.reporter=text'],
    {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
      encoding: 'utf8',
    }
  )

  if (result.status !== 0) {
    console.error('\n✗ Tests failed — fix failing tests before committing.\n')
    process.exit(1)
  }
}

function loadCoverage() {
  if (!fs.existsSync(COVERAGE_FILE)) {
    console.error(`✗ Coverage file not found at ${COVERAGE_FILE}`)
    process.exit(1)
  }
  return JSON.parse(fs.readFileSync(COVERAGE_FILE, 'utf8'))
}

function pct(covered, total) {
  if (total === 0) return 100
  return (covered / total) * 100
}

function checkFile(coverageData, relPath) {
  // coverage-final.json keys are absolute paths; find by suffix
  const absKey = Object.keys(coverageData).find((k) => k.endsWith('/' + relPath) || k === relPath)
  if (!absKey) {
    // No coverage data at all — 0%
    return { lines: 0, statements: 0, branches: 0, functions: 0, missing: true }
  }
  const d = coverageData[absKey]
  const stmtValues = d.s ? Object.values(d.s) : []
  const stmtCovered = stmtValues.filter(Boolean).length
  const stmtTotal = stmtValues.length
  const branchFlat = d.b ? Object.values(d.b).flat() : []
  const branchCovered = branchFlat.filter(Boolean).length
  const branchTotal = branchFlat.length
  const fnValues = d.f ? Object.values(d.f) : []
  const fnCovered = fnValues.filter(Boolean).length
  const fnTotal = fnValues.length
  // `l` (lines) is absent in v8 coverage — fall back to statements
  const lineValues = d.l ? Object.values(d.l) : stmtValues
  const lineCovered = lineValues.filter(Boolean).length
  const lineTotal = lineValues.length
  return {
    lines: pct(lineCovered, lineTotal),
    statements: pct(stmtCovered, stmtTotal),
    branches: pct(branchCovered, branchTotal),
    functions: pct(fnCovered, fnTotal),
    missing: false,
  }
}

function main() {
  const staged = getStagedSourceFiles()
  if (staged.length === 0) {
    console.log('✓ No staged source files — skipping patch coverage check.')
    process.exit(0)
  }

  console.log(`\nPatch coverage check for ${staged.length} staged source file(s):`)
  staged.forEach((f) => console.log(`  ${f}`))

  runCoverage()

  const coverageData = loadCoverage()
  const failures = []

  for (const file of staged) {
    const result = checkFile(coverageData, file)
    const metrics = ['lines', 'statements', 'branches', 'functions']
    const below = metrics.filter((m) => result[m] < THRESHOLD)

    if (result.missing || below.length > 0) {
      failures.push({ file, result, below: result.missing ? ['(no coverage data)'] : below })
    }
  }

  if (failures.length === 0) {
    console.log(`\n✓ All staged files meet ${THRESHOLD}% coverage threshold.\n`)
    process.exit(0)
  }

  console.error(`\n✗ Patch coverage below ${THRESHOLD}% threshold:\n`)
  for (const { file, result, below } of failures) {
    console.error(`  ${file}`)
    if (result.missing) {
      console.error(`    → No coverage data found (0%). Add tests for this file.`)
    } else {
      for (const m of below) {
        console.error(`    → ${m}: ${result[m].toFixed(1)}% (need ${THRESHOLD}%)`)
      }
    }
  }
  console.error(`\nAdd tests for the lines above before committing.\n`)
  process.exit(1)
}

main()
