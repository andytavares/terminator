import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const PROVIDERS_PATH = (workspaceRoot: string) =>
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

export async function readProviders(workspaceRoot: string): Promise<StoredProvider[]> {
  try {
    const raw = await fs.readFile(PROVIDERS_PATH(workspaceRoot), 'utf-8')
    return JSON.parse(raw) as StoredProvider[]
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

export async function writeProviders(
  workspaceRoot: string,
  providers: StoredProvider[]
): Promise<void> {
  const foundryDir = path.join(workspaceRoot, '.foundry')
  await fs.mkdir(foundryDir, { recursive: true })
  const tmpPath = PROVIDERS_PATH(workspaceRoot) + '.tmp'
  await fs.writeFile(tmpPath, JSON.stringify(providers, null, 2), 'utf-8')
  await fs.rename(tmpPath, PROVIDERS_PATH(workspaceRoot))
}
