import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { makeTempDir } from '../../support/temp-dir'

let userData: string

vi.mock('electron', () => ({ app: { getPath: () => userData } }))

async function load() {
  vi.resetModules()
  return import('../../../src/main/integrations/issue-link-store')
}

/** What the store last wrote to disk. */
function storedLinks(): { projectId: string; key: string }[] {
  return JSON.parse(fs.readFileSync(path.join(userData, 'issue-links.json'), 'utf8'))
}

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  userData = makeTempDir('issue-link-store-')
})

describe('issue-link-store — set and read', () => {
  it('stores a link and reads it back', async () => {
    const store = await load()
    await store.setLink({ projectId: P1, tracker: 'linear', key: 'TAV-42', injectContext: true })

    expect(store.getLink(P1)).toMatchObject({
      projectId: P1,
      tracker: 'linear',
      key: 'TAV-42',
      injectContext: true,
    })
  })

  it('stamps when the link was made', async () => {
    const store = await load()
    await store.setLink({ projectId: P1, tracker: 'linear', key: 'TAV-42', injectContext: true })
    expect(Date.parse(store.getLink(P1)?.linkedAt ?? '')).not.toBeNaN()
  })

  it('returns null for a project with no link', async () => {
    const store = await load()
    expect(store.getLink(P1)).toBeNull()
  })
})

describe('issue-link-store — several links', () => {
  it('keeps links for different projects apart', async () => {
    const store = await load()
    await store.setLink({ projectId: P1, tracker: 'linear', key: 'TAV-42', injectContext: true })
    await store.setLink({ projectId: P2, tracker: 'linear', key: 'TAV-7', injectContext: false })

    expect(store.getLink(P1)?.key).toBe('TAV-42')
    expect(store.getLink(P2)?.key).toBe('TAV-7')
  })

  it('lets two projects share one issue', async () => {
    const store = await load()
    await store.setLink({ projectId: P1, tracker: 'linear', key: 'TAV-42', injectContext: true })
    await store.setLink({ projectId: P2, tracker: 'linear', key: 'TAV-42', injectContext: false })

    // Permitted by design, and each keeps its own injection setting.
    expect(store.getLink(P1)?.injectContext).toBe(true)
    expect(store.getLink(P2)?.injectContext).toBe(false)
  })
})

describe('issue-link-store — one issue per project (FR-033)', () => {
  it('replaces rather than accumulating', async () => {
    const store = await load()
    await store.setLink({ projectId: P1, tracker: 'linear', key: 'TAV-42', injectContext: true })
    await store.setLink({ projectId: P1, tracker: 'linear', key: 'TAV-7', injectContext: false })

    expect(store.getLink(P1)).toMatchObject({ tracker: 'linear', key: 'TAV-7' })
    expect(storedLinks().filter((link) => link.projectId === P1)).toHaveLength(1)
  })

  it('carries the previous injection setting when none is given', async () => {
    const store = await load()
    await store.setLink({ projectId: P1, tracker: 'linear', key: 'TAV-42', injectContext: false })
    await store.setLink({ projectId: P1, tracker: 'linear', key: 'TAV-43' })

    // Relinking should not silently switch injection back on.
    expect(store.getLink(P1)?.injectContext).toBe(false)
  })

  it("defaults injection on for a project's first link", async () => {
    const store = await load()
    await store.setLink({ projectId: P1, tracker: 'linear', key: 'TAV-42' })
    expect(store.getLink(P1)?.injectContext).toBe(true)
  })
})

describe('issue-link-store — injection toggle', () => {
  it('flips injection without disturbing the link', async () => {
    const store = await load()
    await store.setLink({ projectId: P1, tracker: 'linear', key: 'TAV-42', injectContext: true })
    await store.setInjectContext(P1, false)

    expect(store.getLink(P1)).toMatchObject({ key: 'TAV-42', injectContext: false })
  })

  it('does nothing for a project with no link', async () => {
    const store = await load()
    await expect(store.setInjectContext(P1, false)).resolves.toBeUndefined()
    expect(store.getLink(P1)).toBeNull()
  })
})

describe('issue-link-store — clear', () => {
  it('removes the link', async () => {
    const store = await load()
    await store.setLink({ projectId: P1, tracker: 'linear', key: 'TAV-42', injectContext: true })
    await store.clearLink(P1)
    expect(store.getLink(P1)).toBeNull()
  })

  it('leaves other projects alone', async () => {
    const store = await load()
    await store.setLink({ projectId: P1, tracker: 'linear', key: 'TAV-42', injectContext: true })
    await store.setLink({ projectId: P2, tracker: 'linear', key: 'TAV-43', injectContext: true })
    await store.clearLink(P1)
    expect(store.getLink(P2)?.key).toBe('TAV-43')
  })

  it('is harmless on a project that was never linked', async () => {
    const store = await load()
    await expect(store.clearLink(P1)).resolves.toBeUndefined()
  })
})

describe('issue-link-store — persistence', () => {
  it('survives a reload', async () => {
    const first = await load()
    await first.setLink({ projectId: P1, tracker: 'linear', key: 'TAV-42', injectContext: true })

    const second = await load()
    await second.loadLinks()
    expect(second.getLink(P1)?.key).toBe('TAV-42')
  })

  it('treats a corrupt file as no links rather than failing startup', async () => {
    fs.writeFileSync(path.join(userData, 'issue-links.json'), 'not json', 'utf8')
    const store = await load()
    await expect(store.loadLinks()).resolves.toBeUndefined()
    expect(store.getLink(P1)).toBeNull()
  })
})

describe('issue-link-store — stored entries', () => {
  it('ignores stored entries that are not links', async () => {
    // The file is on disk and hand-editable; a malformed row must not take
    // out the rest of the operator's links.
    fs.writeFileSync(
      path.join(userData, 'issue-links.json'),
      JSON.stringify([
        { projectId: P1, tracker: 'linear', key: 'TAV-42' },
        { projectId: P2, tracker: 'asana', key: 'X-1' },
        { projectId: 42, tracker: 'linear', key: 'TAV-1' },
        { projectId: P2, key: 'TAV-2' },
        { projectId: P2, tracker: 'linear' },
        'not an object',
        null,
      ]),
      'utf8'
    )
    const store = await load()
    await store.loadLinks()

    expect(store.getLink(P1)?.key).toBe('TAV-42')
    expect(store.getLink(P2)).toBeNull()
    // Writing back keeps the one link it read and nothing else.
    await store.setInjectContext(P1, false)
    expect(storedLinks().map((link) => link.key)).toEqual(['TAV-42'])
  })

  it('treats a stored file that is not a list as no links', async () => {
    fs.writeFileSync(path.join(userData, 'issue-links.json'), '{"nope":true}', 'utf8')
    const store = await load()
    await store.loadLinks()
    expect(store.getLink(P1)).toBeNull()
  })
})

describe('issue-link-store — stored fields', () => {
  it('defaults injection on for a stored entry that omits it', async () => {
    fs.writeFileSync(
      path.join(userData, 'issue-links.json'),
      JSON.stringify([{ projectId: P1, tracker: 'linear', key: 'TAV-42' }]),
      'utf8'
    )
    const store = await load()
    await store.loadLinks()
    expect(store.getLink(P1)?.injectContext).toBe(true)
  })

  it('keeps a stored injectContext of false', async () => {
    fs.writeFileSync(
      path.join(userData, 'issue-links.json'),
      JSON.stringify([{ projectId: P1, tracker: 'linear', key: 'TAV-42', injectContext: false }]),
      'utf8'
    )
    const store = await load()
    await store.loadLinks()
    expect(store.getLink(P1)?.injectContext).toBe(false)
  })
})

describe('issue-link-store — stored timestamps and temp files', () => {
  it('stamps a link that was stored without a timestamp', async () => {
    fs.writeFileSync(
      path.join(userData, 'issue-links.json'),
      JSON.stringify([{ projectId: P1, tracker: 'linear', key: 'TAV-42', linkedAt: 7 }]),
      'utf8'
    )
    const store = await load()
    await store.loadLinks()
    expect(Date.parse(store.getLink(P1)?.linkedAt ?? '')).not.toBeNaN()
  })

  it('leaves no temp file behind', async () => {
    const store = await load()
    await store.setLink({ projectId: P1, tracker: 'linear', key: 'TAV-42', injectContext: true })
    expect(fs.readdirSync(userData).filter((f) => f.endsWith('.tmp'))).toHaveLength(0)
  })
})

describe('issue-link-store — garbage collection', () => {
  it('discards a link when its project is deleted', async () => {
    const store = await load()
    const { emitProjectDelete } = await import('../../../src/main/extensions/workspace-events')

    await store.setLink({ projectId: P1, tracker: 'linear', key: 'TAV-42', injectContext: true })
    store.registerLinkGarbageCollection()
    emitProjectDelete(P1)

    // The event is synchronous but the write is not; the in-memory view is
    // what every reader uses, so that is what must be gone immediately.
    expect(store.getLink(P1)).toBeNull()
  })

  it('leaves other projects linked', async () => {
    const store = await load()
    const { emitProjectDelete } = await import('../../../src/main/extensions/workspace-events')

    await store.setLink({ projectId: P1, tracker: 'linear', key: 'TAV-42', injectContext: true })
    await store.setLink({ projectId: P2, tracker: 'linear', key: 'TAV-43', injectContext: true })
    store.registerLinkGarbageCollection()
    emitProjectDelete(P1)

    expect(store.getLink(P2)?.key).toBe('TAV-43')
  })

  it('can be unregistered', async () => {
    const store = await load()
    const { emitProjectDelete } = await import('../../../src/main/extensions/workspace-events')

    await store.setLink({ projectId: P1, tracker: 'linear', key: 'TAV-42', injectContext: true })
    const dispose = store.registerLinkGarbageCollection()
    dispose()
    emitProjectDelete(P1)

    expect(store.getLink(P1)?.key).toBe('TAV-42')
  })
})
