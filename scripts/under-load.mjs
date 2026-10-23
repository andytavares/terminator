#!/usr/bin/env node
// Runs a command while every core is kept busy, to see whether a test depends on how fast the
// machine is (ADR 123): `node scripts/under-load.mjs [--threads N] -- npx vitest run <spec>`.
// The load is threads of this process, so it ends with it; `yes > /dev/null &` outlived its shell.

import { spawn } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

const SPIN = 'for (;;) {}'

/** `count` threads that each keep one core busy, and the way to end them all. */
export function startLoad(count) {
  const threads = Array.from({ length: count }, () => new Worker(SPIN, { eval: true }))
  const stop = async () => {
    await Promise.all(threads.map((thread) => thread.terminate()))
  }
  return { threads, stop }
}

/** `--threads N` (one per core by default), then the command after `--`. */
export function underLoadArguments(argv) {
  const split = argv.indexOf('--')
  const flags = split === -1 ? argv : argv.slice(0, split)
  const at = flags.indexOf('--threads')
  const threads = at === -1 ? availableParallelism() : Number(flags[at + 1])
  return { threads, command: split === -1 ? [] : argv.slice(split + 1) }
}

async function main() {
  const { threads, command } = underLoadArguments(process.argv.slice(2))
  if (command.length === 0) {
    console.error('Usage: node scripts/under-load.mjs [--threads N] -- <command> [args…]')
    process.exit(2)
  }
  const load = startLoad(threads)
  const child = spawn(command[0], command.slice(1), { stdio: 'inherit' })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
  const code = await new Promise((resolve) => child.on('close', (status) => resolve(status ?? 1)))
  await load.stop()
  process.exit(code)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
