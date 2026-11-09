import { callToolText, type ToolClient } from '../cli.js'
import { resultRows, type Row } from '../output.js'

/** The lists of the left pane, each filled by its read-only tool. */
export const LISTS = [
  { title: 'Workspaces', tool: 'list_workspaces' },
  { title: 'Tasks', tool: 'list_tasks' },
  { title: 'Agents', tool: 'list_agents' },
  { title: 'Terminals', tool: 'list_terminal_sessions' },
  { title: 'Schedules', tool: 'list_schedules' },
  { title: 'Notifications', tool: 'list_notifications' },
]

export interface Snapshot {
  version: string
  /** The rows of each of LISTS, in its order. */
  lists: Row[][]
  loadedAt: number
}

export async function loadSnapshot(client: ToolClient, now: () => number): Promise<Snapshot> {
  const [version, lists] = await Promise.all([
    appVersion(client),
    Promise.all(LISTS.map((list) => listRows(client, list.tool))),
  ])
  return { version, lists, loadedAt: now() }
}

// A list the app does not have, or that fails, shows as empty rather than ending the view.
async function listRows(client: ToolClient, tool: string): Promise<Row[]> {
  try {
    return resultRows(await callToolText(client, tool, {}))
  } catch {
    return []
  }
}

async function appVersion(client: ToolClient): Promise<string> {
  try {
    const info = JSON.parse(await callToolText(client, 'get_app_info', {})) as { version?: string }
    return info.version ?? ''
  } catch {
    return ''
  }
}

/** The rows whose text contains the filter, ignoring case. */
export function filteredRows(rows: Row[], filter: string): Row[] {
  const needle = filter.toLowerCase()
  return rows.filter((row) => JSON.stringify(row).toLowerCase().includes(needle))
}

/** The title or name of the row whose id is one of the arguments, for the confirm question. */
export function knownName(args: Record<string, unknown>, rows: Row[]): string | null {
  const ids = Object.values(args)
  const row = rows.find((candidate) => ids.includes(candidate.id))
  const name = row?.title ?? row?.name
  return typeof name === 'string' ? name : null
}
