import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export async function computeHash(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath)
    const hash = createHash('sha256').update(content).digest('hex')
    return hash
  } catch {
    return null
  }
}

export function getDisplayHash(fullHash: string): string {
  return fullHash.slice(0, 8)
}
