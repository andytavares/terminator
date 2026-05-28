import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { Harness } from '../types/foundry.types.js'

const HARNESS_PATH = (workspaceRoot: string) => path.join(workspaceRoot, '.foundry', 'harness.json')

const SECRET_KEYS = new Set(['apiKey', 'secret', 'password', 'token'])

function stripSecrets(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !SECRET_KEYS.has(k)))
}

export async function readHarness(
  workspaceRoot: string
): Promise<{ harness: Harness } | { notFound: true } | { error: string }> {
  try {
    const raw = await fs.readFile(HARNESS_PATH(workspaceRoot), 'utf-8')
    const parsed = stripSecrets(JSON.parse(raw) as Record<string, unknown>)
    return { harness: parsed as unknown as Harness }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { notFound: true }
    }
    return { error: String(err) }
  }
}

export async function writeHarness(
  workspaceRoot: string,
  harness: Harness
): Promise<{ ok: true } | { error: string }> {
  try {
    const foundryDir = path.join(workspaceRoot, '.foundry')
    await fs.mkdir(foundryDir, { recursive: true })
    const safe = stripSecrets(harness as unknown as Record<string, unknown>)
    const tmpPath = HARNESS_PATH(workspaceRoot) + '.tmp'
    await fs.writeFile(tmpPath, JSON.stringify(safe, null, 2), 'utf-8')
    await fs.rename(tmpPath, HARNESS_PATH(workspaceRoot))
    return { ok: true }
  } catch (err) {
    return { error: String(err) }
  }
}

export async function detectHarnessSetupRequired(workspaceRoot: string): Promise<boolean> {
  try {
    await fs.access(path.join(workspaceRoot, 'AGENTS.md'))
    return false
  } catch {
    return true
  }
}
