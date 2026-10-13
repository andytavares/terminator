const LEGACY_TOKEN_KEY = 'remote_token'

/** Older versions kept the password here; it must not outlive the upgrade. */
export function forgetLegacyToken(): void {
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY)
  } catch {
    // storage unavailable: nothing was kept
  }
}

// The session cookie from POST /api/login authorises the request; a 401 means
// it ended (expired, or the password changed), so the person logs in again.
async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, { ...init, credentials: 'same-origin' })
  if (res.status === 401) location.replace('/')
  return res
}

export interface CreateTerminalOptions {
  cwd: string
  tabTitle?: string
}

export async function createTerminal(opts: CreateTerminalOptions): Promise<{ sessionId: string }> {
  const res = await apiFetch('/api/terminals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd: opts.cwd, type: 'human', tabTitle: opts.tabTitle || 'Remote' }),
  })
  if (!res.ok) throw new Error(`createTerminal failed: ${res.status}`)
  return res.json()
}

export async function resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void> {
  await apiFetch(`/api/terminals/${sessionId}/resize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cols, rows }),
  })
}

export async function getWsTicket(sessionId: string): Promise<string> {
  const res = await apiFetch(`/api/terminals/${sessionId}/ws-ticket`, { method: 'POST' })
  if (!res.ok) throw new Error(`getWsTicket failed: ${res.status}`)
  const data = (await res.json()) as { ticket: string }
  return data.ticket
}

export interface Workspace {
  id: string
  name: string
  folderPath: string
  color: string
  tags: string[]
}

/** @internal */
export interface Project {
  id: string
  workspaceId: string
  name: string
  worktreePath?: string
  gitBranch?: string
}

export interface TerminalSession {
  sessionId: string
  cwd: string
  createdAt: string
  workspaceId?: string
}

export async function listTerminals(): Promise<TerminalSession[]> {
  const res = await apiFetch('/api/terminals')
  if (!res.ok) throw new Error(`listTerminals failed: ${res.status}`)
  return res.json()
}

export async function assignTerminalWorkspace(
  sessionId: string,
  workspaceId: string | null
): Promise<void> {
  const res = await apiFetch(`/api/terminals/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId }),
  })
  if (!res.ok) throw new Error(`assignTerminalWorkspace failed: ${res.status}`)
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const res = await apiFetch('/api/workspaces')
  if (!res.ok) throw new Error(`listWorkspaces failed: ${res.status}`)
  return res.json()
}

/** @internal */
export async function listProjects(workspaceId: string): Promise<Project[]> {
  const res = await apiFetch(`/api/projects?workspaceId=${encodeURIComponent(workspaceId)}`)
  if (!res.ok) throw new Error(`listProjects failed: ${res.status}`)
  return res.json()
}
