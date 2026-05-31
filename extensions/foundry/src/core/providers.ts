import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { app } from 'electron'

// Global providers file — shared across all workspaces
const GLOBAL_PROVIDERS_PATH = () => path.join(app.getPath('userData'), 'foundry', 'providers.json')

// Legacy per-workspace path — used only for one-time migration
const LEGACY_PROVIDERS_PATH = (workspaceRoot: string) =>
  path.join(workspaceRoot, '.foundry', 'providers.json')

export interface StoredProvider {
  id: string
  type: string
  label: string
  model: string
  keychainKey?: string
  endpoint?: string
  supportsStreaming?: boolean
  // Rate-limit / retry controls
  maxRetries?: number // how many times to retry on 429 (default: 4)
  requestDelayMs?: number // fixed delay between requests in ms (default: 0)
  [key: string]: unknown
}

async function migrateFromWorkspace(workspaceRoot: string): Promise<StoredProvider[]> {
  const legacyPath = LEGACY_PROVIDERS_PATH(workspaceRoot)
  try {
    const raw = await fs.readFile(legacyPath, 'utf-8')
    const providers = JSON.parse(raw) as StoredProvider[]
    if (providers.length > 0) {
      // Migrate: write to global path, delete legacy file
      await writeProviders(providers)
      await fs.unlink(legacyPath).catch(() => {})
    }
    return providers
  } catch {
    return []
  }
}

export async function readProviders(workspaceRoot?: string): Promise<StoredProvider[]> {
  try {
    const raw = await fs.readFile(GLOBAL_PROVIDERS_PATH(), 'utf-8')
    return JSON.parse(raw) as StoredProvider[]
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    // Global file not found — check for legacy per-workspace file and migrate
    if (workspaceRoot) {
      return migrateFromWorkspace(workspaceRoot)
    }
    return []
  }
}

export async function writeProviders(providers: StoredProvider[]): Promise<void> {
  const globalDir = path.dirname(GLOBAL_PROVIDERS_PATH())
  await fs.mkdir(globalDir, { recursive: true })
  const tmpPath = GLOBAL_PROVIDERS_PATH() + '.tmp'
  await fs.writeFile(tmpPath, JSON.stringify(providers, null, 2), 'utf-8')
  await fs.rename(tmpPath, GLOBAL_PROVIDERS_PATH())
}
