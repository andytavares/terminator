import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const notified = vi.hoisted(() => vi.fn())
const callRendererTool = vi.hoisted(() => vi.fn())

vi.mock('../../../src/main/notifications/notification-manager', () => ({
  notificationManager: { create: notified },
}))
vi.mock('../../../src/main/mcp/renderer-tools', () => ({ callRendererTool }))

const ID = '3f2a9c1e-7b4d-4e0a-9f1c-2d8e6b5a4c3f'
const caller = { sessionId: ID, claudePid: 4242, projectDir: '/Users/me/repos/shop' }

let root: string
let running: Set<number>
let checks: Array<() => Promise<void>>

/** Runs every scheduled check once, as one second passing would, and waits for what it started. */
const secondPasses = async (): Promise<void> => {
  await Promise.all([...checks].map((check) => check()))
}

function writeTranscript(id: string, lines: unknown[]): void {
  mkdirSync(join(root, '-Users-me-repos-shop'), { recursive: true })
  const text = lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line)))
  writeFileSync(join(root, '-Users-me-repos-shop', `${id}.jsonl`), text.join('\n') + '\n')
}

async function load() {
  const feed = await import('../../../src/main/home/home-feed')
  const { createMoveSession } = await import('../../../src/main/mcp/move-session')
  const provider = createMoveSession({
    projectsRoot: root,
    isRunning: (pid) => running.has(pid),
    everySecond: (check) => {
      checks.push(check)
      return () => checks.splice(checks.indexOf(check), 1)
    },
  })
  const [tool] = provider.tools()
  return { feed, tool }
}

beforeEach(() => {
  vi.resetModules()
  notified.mockReset()
  callRendererTool.mockReset().mockResolvedValue({ sessionId: 'tab-1' })
  root = mkdtempSync(join(tmpdir(), 'move-session-'))
  running = new Set([4242])
  checks = []
  writeTranscript(ID, [
    { type: 'user', cwd: '/Users/me/repos/shop' },
    { type: 'assistant', cwd: '/Users/me/repos/shop/api' },
    { type: 'summary' },
    'not json',
  ])
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('move_session_here, refusals', () => {
  it('is one tool named move_session_here that is not destructive', async () => {
    const { tool } = await load()
    expect(tool.name).toBe('move_session_here')
    expect(tool.annotations).toEqual({ destructiveHint: false })
  })

  it('refuses a session that reported no id, or an id that is not one', async () => {
    const { feed, tool } = await load()
    const refusal = 'This session did not report its id, so it cannot move.'
    await expect(tool.call({}, { ...caller, sessionId: null })).rejects.toThrow(refusal)
    await expect(tool.call({}, { ...caller, sessionId: 'x; rm -rf ~' })).rejects.toThrow(refusal)
    expect(feed.getMergedFeed().asks).toEqual([])
    expect(checks).toEqual([])
  })

  it('refuses when no transcript has the id, or the transcript names no folder', async () => {
    const { feed, tool } = await load()
    await expect(tool.call({}, { ...caller, sessionId: 'unknown' })).rejects.toThrow(/transcript/)
    writeTranscript('nofolder', [{ type: 'summary' }])
    await expect(tool.call({}, { ...caller, sessionId: 'nofolder' })).rejects.toThrow(/folder/)
    expect(feed.getMergedFeed().asks).toEqual([])
    expect(notified).not.toHaveBeenCalled()
  })
})

describe('move_session_here, the moving row', () => {
  it('returns at once and shows the moving row on Home with a sessionMoving notification', async () => {
    const { feed, tool } = await load()
    const result = await tool.call({}, caller)
    expect(result).toEqual({
      moving: true,
      message:
        'Exit this session now (/exit, or close it in the Claude app). Terminator opens it as soon as it ends.',
    })
    const [ask] = feed.getMergedFeed().asks
    expect(ask).toMatchObject({
      title: 'A Claude session is moving here',
      where: 'Claude · /Users/me/repos/shop/api',
      detail: 'It opens in a terminal tab as soon as you exit it there.',
      actions: [
        { id: 'open-copy', label: 'Open a copy now', primary: true },
        { id: 'cancel', label: 'Cancel' },
      ],
    })
    expect(notified).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'A Claude session is moving here', key: 'sessionMoving' })
    )
    expect(callRendererTool).not.toHaveBeenCalled()
  })
})

describe('move_session_here, opening the tab', () => {
  it('opens the session only once its claude process is gone, then removes the row', async () => {
    const { feed, tool } = await load()
    await tool.call({ workspace: 'shop' }, caller)
    await secondPasses()
    expect(callRendererTool).not.toHaveBeenCalled()
    running.delete(4242)
    await secondPasses()
    expect(callRendererTool).toHaveBeenCalledExactlyOnceWith('open_terminal', {
      cwd: '/Users/me/repos/shop/api',
      command: `claude --resume ${ID}`,
      workspace: 'shop',
    })
    expect(checks).toEqual([])
    expect(feed.getMergedFeed().asks).toEqual([])
  })

  it('keeps the row and shows the reason in plain words when the tab cannot open', async () => {
    callRendererTool.mockRejectedValueOnce(new Error('Terminator did not answer in time'))
    const { feed, tool } = await load()
    await tool.call({}, caller)
    const [ask] = feed.getMergedFeed().asks
    await feed.runAction('claude-moves', ask.id, 'open-copy')
    expect(feed.getMergedFeed().asks).toEqual([
      expect.objectContaining({
        id: ask.id,
        detail: 'The terminal tab did not open: Terminator did not answer in time',
      }),
    ])
  })
})

describe('move_session_here, Open a copy now', () => {
  it('Open a copy now stops watching and opens a fork of the session', async () => {
    const { feed, tool } = await load()
    await tool.call({}, caller)
    const [ask] = feed.getMergedFeed().asks
    await feed.runAction('claude-moves', ask.id, 'open-copy')
    expect(callRendererTool).toHaveBeenCalledExactlyOnceWith('open_terminal', {
      cwd: '/Users/me/repos/shop/api',
      command: `claude --resume ${ID} --fork-session`,
    })
    expect(checks).toEqual([])
    expect(feed.getMergedFeed().asks).toEqual([])
  })
})

describe('move_session_here, Cancel and a second move', () => {
  it('Cancel stops watching and removes the row without opening anything', async () => {
    const { feed, tool } = await load()
    await tool.call({}, caller)
    const [ask] = feed.getMergedFeed().asks
    await feed.runAction('claude-moves', ask.id, 'cancel')
    expect(checks).toEqual([])
    expect(feed.getMergedFeed().asks).toEqual([])
    running.delete(4242)
    await secondPasses()
    expect(callRendererTool).not.toHaveBeenCalled()
  })

  it('a second move of the same session replaces the first', async () => {
    const { feed, tool } = await load()
    running.add(5151)
    await tool.call({}, caller)
    await tool.call({ workspace: 'shop' }, { ...caller, claudePid: 5151 })
    expect(feed.getMergedFeed().asks).toHaveLength(1)
    expect(checks).toHaveLength(1)
    running.delete(4242)
    await secondPasses()
    expect(callRendererTool).not.toHaveBeenCalled()
  })
})
