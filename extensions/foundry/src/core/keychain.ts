import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { app, safeStorage } from 'electron'

const SERVICE = 'Terminator Foundry'

// ─── macOS Keychain (primary) ────────────────────────────────────────────────

function runSecurity(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('security', args, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

async function macosStore(keyId: string, secret: string): Promise<void> {
  // -U updates existing item if already present
  await runSecurity(['add-generic-password', '-s', SERVICE, '-a', keyId, '-w', secret, '-U'])
}

async function macosRetrieve(keyId: string): Promise<string | null> {
  try {
    const stdout = await runSecurity(['find-generic-password', '-s', SERVICE, '-a', keyId, '-w'])
    return stdout.trimEnd()
  } catch {
    return null
  }
}

async function macosDelete(keyId: string): Promise<void> {
  try {
    await runSecurity(['delete-generic-password', '-s', SERVICE, '-a', keyId])
  } catch {
    // Key may not exist — not an error
  }
}

// ─── Fallback: safeStorage encrypted blob in Electron userData ───────────────
// Used on Windows and Linux. The blob is stored in the app's userData directory,
// not in the workspace, so it is never accidentally committed to git.

function getUserDataPath(): string {
  try {
    return app.getPath('userData')
  } catch {
    return path.join(process.env['HOME'] ?? '/tmp', '.terminator-foundry-keys')
  }
}

function getEncStorePath(): string {
  return path.join(getUserDataPath(), 'foundry-keys.enc')
}

type EncStore = Record<string, string>

async function encReadStore(): Promise<EncStore> {
  try {
    const raw = await fs.readFile(getEncStorePath(), 'utf-8')
    return JSON.parse(raw) as EncStore
  } catch {
    return {}
  }
}

async function encWriteStore(store: EncStore): Promise<void> {
  const dir = path.dirname(getEncStorePath())
  await fs.mkdir(dir, { recursive: true })
  const tmp = getEncStorePath() + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(store), 'utf-8')
  await fs.rename(tmp, getEncStorePath())
}

async function encStore(keyId: string, secret: string): Promise<void> {
  const encrypted = safeStorage.encryptString(secret).toString('base64')
  const store = await encReadStore()
  store[keyId] = encrypted
  await encWriteStore(store)
}

async function encRetrieve(keyId: string): Promise<string | null> {
  const store = await encReadStore()
  const b64 = store[keyId]
  if (!b64) return null
  return safeStorage.decryptString(Buffer.from(b64, 'base64'))
}

async function encDelete(keyId: string): Promise<void> {
  const store = await encReadStore()
  if (keyId in store) {
    delete store[keyId]
    await encWriteStore(store)
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function isAvailable(): boolean {
  if (process.platform === 'darwin') return true
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export async function storeKey(keyId: string, secret: string): Promise<void> {
  if (process.platform === 'darwin') {
    await macosStore(keyId, secret)
  } else {
    await encStore(keyId, secret)
  }
}

export async function retrieveKey(keyId: string): Promise<string | null> {
  if (process.platform === 'darwin') {
    return macosRetrieve(keyId)
  }
  return encRetrieve(keyId)
}

export async function deleteKey(keyId: string): Promise<void> {
  if (process.platform === 'darwin') {
    await macosDelete(keyId)
  } else {
    await encDelete(keyId)
  }
}
