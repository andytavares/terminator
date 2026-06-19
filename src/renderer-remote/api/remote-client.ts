const TOKEN_KEY = 'remote_token'

function getToken(): string {
  return sessionStorage.getItem(TOKEN_KEY) ?? ''
}

export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY)
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `Bearer ${getToken()}`)
  return fetch(path, { ...init, headers })
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

export async function deleteTerminal(sessionId: string): Promise<void> {
  await apiFetch(`/api/terminals/${sessionId}`, { method: 'DELETE' })
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
}

export async function listTerminals(): Promise<TerminalSession[]> {
  const res = await apiFetch('/api/terminals')
  if (!res.ok) throw new Error(`listTerminals failed: ${res.status}`)
  return res.json()
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const res = await apiFetch('/api/workspaces')
  if (!res.ok) throw new Error(`listWorkspaces failed: ${res.status}`)
  return res.json()
}

export async function listProjects(workspaceId: string): Promise<Project[]> {
  const res = await apiFetch(`/api/projects?workspaceId=${encodeURIComponent(workspaceId)}`)
  if (!res.ok) throw new Error(`listProjects failed: ${res.status}`)
  return res.json()
}
