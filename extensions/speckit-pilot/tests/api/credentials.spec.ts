import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

// Mock electron before importing credentials
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(true),
    encryptString: vi.fn((s: string) => Buffer.from(s + '-encrypted')),
    decryptString: vi.fn((b: Buffer) => b.toString().replace('-encrypted', '')),
  },
  app: {
    getPath: vi.fn().mockReturnValue('/mock-user-data'),
  },
}))

vi.mock('node:fs/promises')

import {
  setLinearKey,
  getLinearKey,
  getLinearEmail,
  setLinearEmail,
  setJiraCredentials,
  getJiraCredentials,
} from '../../src/api/credentials.js'
import type { JiraCreds } from '../../src/types/speckit.types.js'

const credsFile = path.join('/mock-user-data', 'speckit-pilot-creds.json')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('setLinearKey / getLinearKey', () => {
  it('stores an encrypted Linear API key', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.rename).mockResolvedValue(undefined)

    await setLinearKey('lin-secret-123')
    expect(fs.writeFile).toHaveBeenCalled()
    const written = vi.mocked(fs.writeFile).mock.calls[0][1] as string
    const parsed = JSON.parse(written)
    // Should be stored as base64, not plain text
    expect(parsed.linearKey).not.toBe('lin-secret-123')
  })

  it('retrieves and decrypts the stored Linear API key', async () => {
    const encrypted = Buffer.from('lin-secret-123-encrypted').toString('base64')
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({ linearKey: encrypted }) as unknown as Uint8Array
    )

    const result = await getLinearKey()
    expect(result).toBe('lin-secret-123')
  })

  it('returns null when no key is stored', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const result = await getLinearKey()
    expect(result).toBeNull()
  })

  it('returns null when stored file has no linearKey field', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}) as unknown as Uint8Array)
    const result = await getLinearKey()
    expect(result).toBeNull()
  })

  it('stores the Linear lookup email (in plain text) and reads it back', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.rename).mockResolvedValue(undefined)
    await setLinearKey('lin-secret', 'me@example.com')
    const written = vi.mocked(fs.writeFile).mock.calls[0][1] as string
    expect(JSON.parse(written).linearEmail).toBe('me@example.com')

    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({ linearEmail: 'me@example.com' }) as unknown as Uint8Array
    )
    expect(await getLinearEmail()).toBe('me@example.com')
  })

  it('returns null Linear email when none stored', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}) as unknown as Uint8Array)
    expect(await getLinearEmail()).toBeNull()
  })

  it('leaves the email untouched when setLinearKey is called without one', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.rename).mockResolvedValue(undefined)
    await setLinearKey('key-only')
    const written = JSON.parse(vi.mocked(fs.writeFile).mock.calls[0][1] as string)
    expect(written.linearEmail).toBeUndefined()
  })

  it('clears the email when an empty string is provided', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.rename).mockResolvedValue(undefined)
    await setLinearKey('key', '   ')
    const afterKey = JSON.parse(vi.mocked(fs.writeFile).mock.calls[0][1] as string)
    expect(afterKey.linearEmail).toBeUndefined()

    vi.mocked(fs.writeFile).mockClear()
    await setLinearEmail('')
    const afterEmail = JSON.parse(vi.mocked(fs.writeFile).mock.calls[0][1] as string)
    expect(afterEmail.linearEmail).toBeUndefined()
  })

  it('setLinearEmail updates the email without touching the stored key', async () => {
    const existing = Buffer.from('lin-secret-encrypted').toString('base64')
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({ linearKey: existing }) as unknown as Uint8Array
    )
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.rename).mockResolvedValue(undefined)
    await setLinearEmail('new@example.com')
    const written = JSON.parse(vi.mocked(fs.writeFile).mock.calls[0][1] as string)
    expect(written.linearEmail).toBe('new@example.com')
    expect(written.linearKey).toBe(existing) // key preserved
  })
})

describe('setJiraCredentials / getJiraCredentials', () => {
  it('stores encrypted Jira credentials', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.rename).mockResolvedValue(undefined)

    const creds: JiraCreds = {
      domain: 'mycompany.atlassian.net',
      email: 'user@mycompany.com',
      apiToken: 'jira-token-abc',
      jql: 'assignee = currentUser()',
    }
    await setJiraCredentials(creds)
    expect(fs.writeFile).toHaveBeenCalled()
    const written = vi.mocked(fs.writeFile).mock.calls[0][1] as string
    const parsed = JSON.parse(written)
    // apiToken should be encrypted, not stored plain
    expect(parsed.jiraCreds?.apiToken).not.toBe('jira-token-abc')
    // domain and email stored plain (not secret)
    expect(parsed.jiraCreds?.domain).toBe('mycompany.atlassian.net')
    expect(parsed.jiraCreds?.email).toBe('user@mycompany.com')
  })

  it('retrieves and decrypts Jira credentials', async () => {
    const encryptedToken = Buffer.from('jira-token-abc-encrypted').toString('base64')
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        jiraCreds: {
          domain: 'mycompany.atlassian.net',
          email: 'user@mycompany.com',
          apiToken: encryptedToken,
          jql: 'assignee = currentUser()',
        },
      }) as unknown as Uint8Array
    )

    const result = await getJiraCredentials()
    expect(result).not.toBeNull()
    expect(result?.apiToken).toBe('jira-token-abc')
    expect(result?.domain).toBe('mycompany.atlassian.net')
  })

  it('returns null when no Jira credentials are stored', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const result = await getJiraCredentials()
    expect(result).toBeNull()
  })

  it('uses atomic tmp-then-rename write pattern', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.rename).mockResolvedValue(undefined)

    await setLinearKey('key123')
    expect(fs.writeFile).toHaveBeenCalledWith(`${credsFile}.tmp`, expect.any(String), 'utf-8')
    expect(fs.rename).toHaveBeenCalledWith(`${credsFile}.tmp`, credsFile)
  })

  it('never exposes apiToken as plain text in stored JSON', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.rename).mockResolvedValue(undefined)

    const creds: JiraCreds = { domain: 'd.net', email: 'e@d.net', apiToken: 'supersecret', jql: '' }
    await setJiraCredentials(creds)
    const written = vi.mocked(fs.writeFile).mock.calls[0][1] as string
    expect(written).not.toContain('supersecret')
  })
})
