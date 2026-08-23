import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { app } from 'electron'
import type { IssueLink, TrackerId } from '../../shared/types/index.js'
import { onProjectDelete } from '../extensions/workspace-events.js'

// A project's attachment to one issue.
//
// Kept beside core's workspace store rather than inside it: this is the
// feature's own state, keyed to a project, and removing the feature should
// remove exactly its own files. The workspace store is read by every other
// surface in the application and does not need a field for this.
//
// Held in memory and mirrored to disk. Every reader — the sidebar badge, the
// agent-context builder, the extension API — is synchronous and on a hot path,
// and none of them should await a file read to decide whether to draw a badge.

const FILE_NAME = 'issue-links.json'

type LinkChangeHandler = (projectId: string, link: IssueLink | null) => void

const links = new Map<string, IssueLink>()
const handlers = new Set<LinkChangeHandler>()

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function announce(projectId: string): void {
  const link = links.get(projectId) ?? null
  for (const handler of handlers) handler(projectId, link)
}

async function persist(): Promise<void> {
  const target = filePath()
  const tmp = `${target}.tmp`
  await fs.writeFile(tmp, JSON.stringify([...links.values()], null, 2), 'utf8')
  await fs.rename(tmp, target)
}

/** Read what was stored. Called once at startup; safe to call again. */
export async function loadLinks(): Promise<void> {
  links.clear()
  let parsed: unknown
  try {
    parsed = JSON.parse(await fs.readFile(filePath(), 'utf8'))
  } catch {
    // Missing or unreadable means no links, never a failed startup.
    return
  }
  if (!Array.isArray(parsed)) return
  for (const entry of parsed) {
    // The file is on disk and hand-editable. A null or a bare string in it
    // used to throw here, which took out every *other* link the operator had.
    if (typeof entry !== 'object' || entry === null) continue
    const link = entry as Partial<IssueLink>
    if (typeof link.projectId !== 'string' || typeof link.key !== 'string') continue
    if (link.tracker !== 'linear' && link.tracker !== 'jira') continue
    links.set(link.projectId, {
      projectId: link.projectId,
      tracker: link.tracker,
      key: link.key,
      injectContext: link.injectContext !== false,
      linkedAt: typeof link.linkedAt === 'string' ? link.linkedAt : new Date().toISOString(),
    })
  }
}

export interface SetLinkInput {
  projectId: string
  tracker: TrackerId
  key: string
  /** Omitted keeps whatever this project had, or defaults on for a first link. */
  injectContext?: boolean
}

/**
 * Attach an issue to a project, replacing whatever was there (FR-033).
 *
 * The injection setting is deliberately sticky: an operator who turned it off
 * for a project meant it for that project, and relinking to a different issue
 * should not quietly turn it back on.
 */
export async function setLink(input: SetLinkInput): Promise<IssueLink> {
  const previous = links.get(input.projectId)
  const link: IssueLink = {
    projectId: input.projectId,
    tracker: input.tracker,
    key: input.key,
    injectContext: input.injectContext ?? previous?.injectContext ?? true,
    linkedAt: new Date().toISOString(),
  }
  links.set(input.projectId, link)
  announce(input.projectId)
  await persist()
  return link
}

export function getLink(projectId: string): IssueLink | null {
  return links.get(projectId) ?? null
}

export function listLinks(): IssueLink[] {
  return [...links.values()]
}

export async function setInjectContext(projectId: string, inject: boolean): Promise<void> {
  const existing = links.get(projectId)
  if (existing === undefined) return
  links.set(projectId, { ...existing, injectContext: inject })
  announce(projectId)
  await persist()
}

export async function clearLink(projectId: string): Promise<void> {
  if (!links.delete(projectId)) return
  announce(projectId)
  await persist()
}

export function onLinkChange(handler: LinkChangeHandler): () => void {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}

/**
 * Discard a link when its project goes (FR-008).
 *
 * The in-memory map is updated synchronously inside the event, because every
 * reader consults it immediately; the write follows.
 */
export function registerLinkGarbageCollection(): () => void {
  return onProjectDelete((projectId) => {
    if (!links.has(projectId)) return
    links.delete(projectId)
    announce(projectId)
    void persist()
  })
}
