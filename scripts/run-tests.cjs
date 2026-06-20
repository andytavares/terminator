#!/usr/bin/env node
'use strict'
// Why this exists: better-sqlite3 is a native module that must be compiled for a
// specific Node.js ABI. Vitest runs under the system Node.js ABI; Electron uses
// its own distinct ABI. Running `npm rebuild better-sqlite3` (system ABI) before
// tests is necessary for integration tests that use real SQLite, but it leaves the
// binary broken for the Electron app. This wrapper rebuilds for system Node.js,
// runs vitest, then ALWAYS restores the Electron ABI binary — even on test failure.
const { execSync, spawnSync } = require('child_process')
const extraArgs = process.argv.slice(2)

execSync('npm rebuild better-sqlite3', { stdio: 'inherit' })

let result
try {
  result = spawnSync('npx', ['vitest', 'run', '--coverage', ...extraArgs], { stdio: 'inherit' })
} finally {
  try {
    execSync('npx electron-rebuild', { stdio: 'inherit' })
  } catch (err) {
    console.error('⚠️  Failed to restore Electron ABI for native modules:', err.message)
    console.error('    Run: npx electron-rebuild')
  }
}

process.exit(result?.status ?? 1)
