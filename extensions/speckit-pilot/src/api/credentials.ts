import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { safeStorage, app } from 'electron'
import type { JiraCreds } from '../types/speckit.types.js'

interface CredsFile {
  linearKey?: string
  jiraCreds?: {
    domain: string
    email: string
    apiToken: string
    jql: string
  }
}

function credsFilePath(): string {
  return path.join(app.getPath('userData'), 'speckit-pilot-creds.json')
}

async function readCredsFile(): Promise<CredsFile> {
  const p = credsFilePath()
  try {
    const raw = await fs.readFile(p, 'utf-8')
    return JSON.parse(raw) as CredsFile
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
}

async function writeCredsFile(data: CredsFile): Promise<void> {
  const p = credsFilePath()
  const tmp = `${p}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
  await fs.rename(tmp, p)
}

function encrypt(value: string): string {
  const encrypted = safeStorage.encryptString(value)
  return encrypted.toString('base64')
}

function decrypt(encoded: string): string {
  const buf = Buffer.from(encoded, 'base64')
  return safeStorage.decryptString(buf)
}

export async function setLinearKey(key: string): Promise<void> {
  const creds = await readCredsFile()
  creds.linearKey = encrypt(key)
  await writeCredsFile(creds)
}

export async function getLinearKey(): Promise<string | null> {
  const creds = await readCredsFile()
  if (!creds.linearKey) return null
  return decrypt(creds.linearKey)
}

export async function setJiraCredentials(jiraCreds: JiraCreds): Promise<void> {
  const creds = await readCredsFile()
  creds.jiraCreds = {
    domain: jiraCreds.domain,
    email: jiraCreds.email,
    apiToken: encrypt(jiraCreds.apiToken),
    jql: jiraCreds.jql,
  }
  await writeCredsFile(creds)
}

export async function getJiraCredentials(): Promise<JiraCreds | null> {
  const creds = await readCredsFile()
  if (!creds.jiraCreds) return null
  return {
    domain: creds.jiraCreds.domain,
    email: creds.jiraCreds.email,
    apiToken: decrypt(creds.jiraCreds.apiToken),
    jql: creds.jiraCreds.jql,
  }
}
