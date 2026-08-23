import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Issue } from '../../../src/shared/types/index'

let userData: string
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-context-'))
})

const { buildAgentContext, MAX_CONTEXT_CHARS } = await import(
  '../../../src/main/integrations/agent-context'
)

function issue(over: Partial<Issue> = {}): Issue {
  return {
    tracker: 'linear',
    id: 'id-1',
    key: 'TAV-42',
    title: 'Unify Linear connections behind one core service',
    url: 'https://linear.app/tav/issue/TAV-42',
    state: { name: 'In Progress', type: 'started' },
    assignee: { name: 'Andrew', email: 'a@b.co' },
    description: '## Summary\n\nReached from three places today.',
    labels: ['Improvement'],
    branchName: 'andrew/tav-42',
    completed: false,
    updatedAt: '2026-08-22T12:00:00.000Z',
    comments: [
      { author: 'andrew', body: 'Fold the migration into P0.', createdAt: '2026-08-22T10:00:00Z' },
    ],
    ...over,
  }
}

describe('buildAgentContext — composition', () => {
  it('leads with the identity, so a truncation never costs it', () => {
    const context = buildAgentContext('p1', issue())
    const [first] = context.markdown.split('\n')
    expect(first).toBe('# Linked issue: TAV-42')
    expect(context.markdown.indexOf('TAV-42')).toBeLessThan(
      context.markdown.indexOf('## Description')
    )
  })

  it('names the title, state, assignee and URL', () => {
    const { markdown } = buildAgentContext('p1', issue())
    expect(markdown).toContain('Unify Linear connections behind one core service')
    expect(markdown).toContain('In Progress')
    expect(markdown).toContain('Andrew')
    expect(markdown).toContain('https://linear.app/tav/issue/TAV-42')
  })

  it('carries the description', () => {
    expect(buildAgentContext('p1', issue()).markdown).toContain('Reached from three places today.')
  })

  it('carries recent comments with their authors', () => {
    const { markdown } = buildAgentContext('p1', issue())
    expect(markdown).toContain('andrew')
    expect(markdown).toContain('Fold the migration into P0.')
  })

  it('says which tracker it came from — two trackers can share a key', () => {
    expect(buildAgentContext('p1', issue({ tracker: 'jira' })).markdown).toContain('Jira')
    expect(buildAgentContext('p1', issue()).markdown).toContain('Linear')
  })

  it('records the project, key and tracker on the context itself', () => {
    const context = buildAgentContext('p1', issue())
    expect(context).toMatchObject({ projectId: 'p1', key: 'TAV-42', tracker: 'linear' })
    expect(Date.parse(context.builtAt)).not.toBeNaN()
  })

  it('reports its own size', () => {
    const context = buildAgentContext('p1', issue())
    expect(context.chars).toBe(context.markdown.length)
  })
})

describe('buildAgentContext — sparse issues', () => {
  it('reads sensibly with no description', () => {
    const { markdown } = buildAgentContext('p1', issue({ description: '' }))
    expect(markdown).toContain('TAV-42')
    expect(markdown).not.toContain('undefined')
    expect(markdown).not.toMatch(/##\s+Description\s*\n\s*\n\s*##/)
  })

  it('omits the comments section entirely when there are none', () => {
    const { markdown } = buildAgentContext('p1', issue({ comments: [] }))
    expect(markdown).not.toContain('Recent comments')
  })

  it('copes with no assignee', () => {
    const { markdown } = buildAgentContext('p1', issue({ assignee: null }))
    expect(markdown).toContain('Unassigned')
  })

  it('includes labels when there are any, and omits the line when there are not', () => {
    expect(buildAgentContext('p1', issue()).markdown).toContain('Improvement')
    expect(buildAgentContext('p1', issue({ labels: [] })).markdown).not.toContain('Labels:')
  })
})

describe('buildAgentContext — budget (FR-022)', () => {
  it('is well within the runtime cap for an ordinary issue', () => {
    const context = buildAgentContext('p1', issue())
    expect(context.truncated).toBe(false)
    expect(context.chars).toBeLessThan(MAX_CONTEXT_CHARS)
  })

  it('never exceeds the runtime cap, however large the issue', () => {
    const context = buildAgentContext(
      'p1',
      issue({
        description: 'x'.repeat(50_000),
        comments: Array.from({ length: 5 }, (_, i) => ({
          author: 'andrew',
          body: 'y'.repeat(10_000),
          createdAt: `2026-08-2${i}T00:00:00Z`,
        })),
      })
    )
    expect(context.chars).toBeLessThanOrEqual(MAX_CONTEXT_CHARS)
    expect(context.truncated).toBe(true)
  })

  it('says it was shortened, and points at the full issue', () => {
    const context = buildAgentContext('p1', issue({ description: 'x'.repeat(50_000) }))
    expect(context.truncated).toBe(true)
    expect(context.markdown).toContain('truncated')
    expect(context.markdown).toContain('https://linear.app/tav/issue/TAV-42')
  })

  it('keeps the identity even when the description swamps everything', () => {
    const { markdown } = buildAgentContext('p1', issue({ description: 'x'.repeat(50_000) }))
    expect(markdown).toContain('# Linked issue: TAV-42')
    expect(markdown).toContain('In Progress')
  })

  it('bounds comments at five, keeping the newest', () => {
    // A provider hands comments over newest-first (see the TrackerProvider
    // invariants); this mirrors that rather than re-sorting here.
    const comments = Array.from({ length: 9 }, (_, i) => ({
      author: 'andrew',
      body: `comment ${8 - i}`,
      createdAt: `2026-08-1${8 - i}T00:00:00Z`,
    }))
    const { markdown } = buildAgentContext('p1', issue({ comments }))
    const included = comments.filter((c) => markdown.includes(c.body))
    expect(included).toHaveLength(5)
    expect(markdown).toContain('comment 8')
    expect(markdown).not.toContain('comment 0')
  })

  it('never cuts a fenced code block open', () => {
    const description = ['prose', '```ts', 'const a = 1', '```', 'x'.repeat(20_000)].join('\n')
    const { markdown } = buildAgentContext('p1', issue({ description }))
    const fences = (markdown.match(/```/g) ?? []).length
    expect(fences % 2).toBe(0)
  })

  it('drops whole blocks rather than mid-sentence where it can', () => {
    const description = Array.from({ length: 400 }, (_, i) => `Paragraph ${i}.`).join('\n\n')
    const { markdown } = buildAgentContext('p1', issue({ description }))
    expect(markdown).toContain('Paragraph 0.')
    // Whatever survived ends at a block boundary, not halfway through a word.
    expect(markdown).not.toMatch(/Paragrap$/)
  })
})

describe('buildAgentContext — no issue', () => {
  it('produces nothing at all rather than an empty shell', () => {
    expect(buildAgentContext('p1', null)).toBeNull()
  })
})

describe('the context file', () => {
  async function mod() {
    return import('../../../src/main/integrations/agent-context')
  }

  it('writes, reads back, and deletes', async () => {
    const { writeContextFile, readContextFile, deleteContextFile } = await mod()
    const context = buildAgentContext('p1', issue())!

    await writeContextFile(context)
    await expect(readContextFile('p1')).resolves.toMatchObject({ key: 'TAV-42' })

    await deleteContextFile('p1')
    await expect(readContextFile('p1')).resolves.toBeNull()
  })

  it('reads null rather than throwing when nothing was written', async () => {
    const { readContextFile } = await mod()
    await expect(readContextFile('never-written')).resolves.toBeNull()
  })

  it('reads null rather than throwing on a malformed file', async () => {
    const { writeContextFile, readContextFile, contextFilePath } = await mod()
    await writeContextFile(buildAgentContext('p1', issue())!)
    fs.writeFileSync(contextFilePath('p1'), '{{{ not json', 'utf8')
    await expect(readContextFile('p1')).resolves.toBeNull()
  })

  it('reads null for JSON that is not an object', async () => {
    const { writeContextFile, readContextFile, contextFilePath } = await mod()
    await writeContextFile(buildAgentContext('p1', issue())!)
    fs.writeFileSync(contextFilePath('p1'), '"a string"', 'utf8')
    await expect(readContextFile('p1')).resolves.toBeNull()
  })

  it('deleting is harmless when there is nothing there', async () => {
    const { deleteContextFile } = await mod()
    await expect(deleteContextFile('nothing')).resolves.toBeUndefined()
  })

  it('leaves no temp file behind', async () => {
    const { writeContextFile, contextFilePath } = await mod()
    await writeContextFile(buildAgentContext('p1', issue())!)
    const dir = path.dirname(contextFilePath('p1'))
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toHaveLength(0)
  })
})
