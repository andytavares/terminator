import * as path from 'node:path'
import type { Autonomy } from '../gates/autonomy.js'

// An ask reaching Foundry is one the role's settings left open (`runtime/role-settings.ts`):
// an Artifact publish, checked here, or anything else, for a person to decide. At
// `lights-out` nobody can, so it is refused and the agent told.

interface PolicyDecision {
  allow: boolean
  reason?: string
}

export interface ToolRequest {
  readonly tool: string
  readonly input: unknown
  readonly autonomy: Autonomy
  /**
   * The order's own `outputs/` directory, where a role that hands back a document
   * publishes it. Null for every other node.
   */
  readonly outputsDir: string | null
}

/** The path a tool call names, whichever field it used to name it. */
function pathOf(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null
  for (const field of ['file_path', 'path', 'notebook_path']) {
    const value = (input as Record<string, unknown>)[field]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
}

/**
 * Whether a named path resolves to the mount itself or somewhere under it.
 *
 * Resolved before comparing, so a `..` segment cannot escape it and a string
 * prefix that merely starts the same way — `/mnt/skills-other` next to
 * `/mnt/skills` — is not mistaken for being inside it.
 */
function isInsideMount(target: string | null, mount: string | null): boolean {
  if (mount === null || target === null) return false
  const resolvedMount = path.resolve(mount)
  const resolvedTarget = path.resolve(target)
  return (
    resolvedTarget === resolvedMount || resolvedTarget.startsWith(`${resolvedMount}${path.sep}`)
  )
}

const PAGE = /\.(html?|md)$/i

/** A publish is the tool's default action; reading or listing artifacts is not one. */
function isPublish(input: unknown): boolean {
  const action = (input as { action?: unknown } | null)?.action
  return action === undefined || action === 'publish'
}

function publishesOwnDocument(request: ToolRequest): boolean {
  const target = pathOf(request.input)
  const attaches = (request.input as { files?: unknown } | null)?.files !== undefined
  return (
    !attaches && target !== null && PAGE.test(target) && isInsideMount(target, request.outputsDir)
  )
}

/** An agent publishes only its order's document page; nothing else in reach leaves the machine. */
function publishDocumentRule(request: ToolRequest): PolicyDecision | undefined {
  if (request.tool !== 'Artifact' || !isPublish(request.input)) return undefined
  if (publishesOwnDocument(request)) {
    return { allow: true, reason: "publishing the order's own document" }
  }
  return {
    allow: false,
    reason: `publish only the order's document: one page (.html, .htm or .md) in ${request.outputsDir ?? 'the outputs directory of a role that hands back a document'}, with no other files attached`,
  }
}

// Decide, or hand to the operator: `null` means ask.
export function decideTool(request: ToolRequest): PolicyDecision | null {
  const published = publishDocumentRule(request)
  if (published !== undefined) return published
  if (request.autonomy !== 'lights-out') return null
  return {
    allow: false,
    reason:
      'this needs a decision, and nobody is here to be asked — this run is unattended. Do the work another way, or leave it for a person.',
  }
}
