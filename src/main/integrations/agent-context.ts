import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { app } from 'electron'
import type { AgentContext, Issue } from '../../shared/types/index.js'
import { writeJsonAtomic } from '@terminator/extension-sdk/node'

// What an agent session is told about the issue its project is for.
//
// The composition is header-first on purpose: if the budget bites, it costs
// discussion, never identity. An agent that knows the key, the title and the
// state but not the third comment is still working on the right thing; one
// that got the tail of a description and no key is not.

/**
 * The runtime's documented ceiling on a hook-output field.
 *
 * Beyond it the runtime does not fail — it writes the value to a file and
 * substitutes a preview and a path, which would silently turn the issue
 * context into a pointer nobody follows. So the budget is enforced here,
 * visibly, and the operator is shown the number (FR-022, FR-023).
 * @internal
 */
export const MAX_CONTEXT_CHARS = 10_000

/** Description budget. The remainder leaves room for header and comments. */
const MAX_DESCRIPTION_CHARS = 4_000
const MAX_COMMENTS = 5

const TRACKER_LABELS = { linear: 'Linear' } as const

/**
 * Trim to a length without leaving a fenced code block open.
 *
 * A half-open fence swallows everything after it in any markdown reader,
 * including the model's, so the whole remainder of the context would read as
 * code. Cutting at a block boundary also stops mid-word truncation.
 */
function trimBlocks(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false }

  const blocks = text.split('\n\n')
  const kept: string[] = []
  let length = 0
  for (const block of blocks) {
    const next = length === 0 ? block.length : length + 2 + block.length
    if (next > limit) break
    kept.push(block)
    length = next
  }
  // A single block longer than the whole budget still has to give: cut it at a
  // line boundary, which is the least bad place left.
  if (kept.length === 0) {
    const lines = text.slice(0, limit).split('\n')
    lines.pop()
    kept.push(lines.join('\n'))
  }

  let out = kept.join('\n\n')
  // An odd number of fences means one was left open by the cut.
  if ((out.match(/```/g) ?? []).length % 2 === 1) out += '\n```'
  return { text: out, truncated: true }
}

interface ComposedContext {
  markdown: string
  truncated: boolean
}

function issueHeader(issue: Issue): string {
  return [
    `# Linked issue: ${issue.key}`,
    issue.title,
    `Tracker: ${TRACKER_LABELS[issue.tracker]} · State: ${issue.state.name} · Assignee: ${
      issue.assignee?.name ?? 'Unassigned'
    }`,
    ...(issue.labels.length > 0 ? [`Labels: ${issue.labels.join(', ')}`] : []),
    `URL: ${issue.url}`,
  ].join('\n')
}

/** Header, description and recent comments, each held to its own budget. */
function composeSections(issue: Issue): ComposedContext {
  const description = trimBlocks(issue.description.trim(), MAX_DESCRIPTION_CHARS)
  const comments = issue.comments.slice(0, MAX_COMMENTS)

  const sections = [issueHeader(issue)]
  if (description.text.length > 0) sections.push(`## Description\n\n${description.text}`)
  if (comments.length > 0) {
    sections.push(
      `## Recent comments (${comments.length})\n\n` +
        comments.map((c) => `**${c.author}**: ${c.body}`).join('\n\n')
    )
  }
  return {
    markdown: sections.join('\n\n'),
    truncated: description.truncated || issue.comments.length > comments.length,
  }
}

/** Whatever the per-section budgets allowed, the whole must still fit — and the footer that
 * admits the truncation has to fit inside it too. */
function fitWithinBudget(composed: ComposedContext, url: string): ComposedContext {
  const footer = `\n\n_— truncated; full issue at ${url}_`
  const overBudget = composed.markdown.length > MAX_CONTEXT_CHARS
  const markdown = overBudget
    ? trimBlocks(composed.markdown, MAX_CONTEXT_CHARS - footer.length).text
    : composed.markdown
  const truncated = composed.truncated || overBudget
  return { markdown: truncated ? markdown + footer : markdown, truncated }
}

/** The text a session receives, and the numbers the operator is shown. Pure: the drawer previews
 * exactly what the file will contain because both come from this function, not from two
 * renderings of the same idea. */
export function buildAgentContext(projectId: string, issue: Issue | null): AgentContext | null {
  if (issue === null) return null
  const { markdown, truncated } = fitWithinBudget(composeSections(issue), issue.url)
  return {
    projectId,
    tracker: issue.tracker,
    key: issue.key,
    markdown,
    chars: markdown.length,
    truncated,
    builtAt: new Date().toISOString(),
  }
}

// ── The file the hook reads ──────────────────────────────────────────────────
//
// One per project, addressed by project id so it survives a rename and cannot
// collide. The hook script reads this and nothing else: it holds no
// credential, makes no request, and knows nothing about trackers.

function contextDir(): string {
  return path.join(app.getPath('userData'), 'integrations', 'context')
}

export function contextFilePath(projectId: string): string {
  return path.join(contextDir(), `${projectId}.json`)
}

export async function writeContextFile(context: AgentContext): Promise<void> {
  await fs.mkdir(contextDir(), { recursive: true })
  await writeJsonAtomic(contextFilePath(context.projectId), context)
}

/** What was last written, or null. Never throws — a missing file is an answer. */
export async function readContextFile(projectId: string): Promise<AgentContext | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(contextFilePath(projectId), 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as AgentContext) : null
  } catch {
    return null
  }
}

export async function deleteContextFile(projectId: string): Promise<void> {
  await fs.rm(contextFilePath(projectId), { force: true })
}
