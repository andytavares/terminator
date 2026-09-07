import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  resolveDataRoot,
  RelativeDataDirError,
  OrderIdEscapesRootError,
  orderDir,
  unitDir,
  laneDir,
  ensureWritable,
} from '../src/data-root.js'

// Where Foundry writes is one setting with two behaviours (FR-074), and it is
// resolved once so that two writers can never disagree about it — a real hazard
// once an order spans repositories and "the working directory" is ambiguous.

describe('resolveDataRoot', () => {
  it('defaults to a .foundry directory beside the working directory', () => {
    const r = resolveDataRoot('', '/repos/terminator')
    expect(r.root).toBe(path.join('/repos/terminator', '.foundry'))
    expect(r.usingDefault).toBe(true)
  })

  it('treats an absent setting the same as an empty one', () => {
    expect(resolveDataRoot(undefined, '/repos/terminator').root).toBe(
      resolveDataRoot('', '/repos/terminator').root
    )
  })

  it('uses a configured absolute path for every repository', () => {
    const a = resolveDataRoot('/var/foundry', '/repos/terminator')
    const b = resolveDataRoot('/var/foundry', '/repos/other')
    expect(a.root).toBe('/var/foundry')
    expect(b.root).toBe('/var/foundry')
    expect(a.usingDefault).toBe(false)
  })

  it('rejects a relative path, which is ambiguous once an order spans repositories', () => {
    expect(() => resolveDataRoot('../foundry', '/repos/terminator')).toThrow(RelativeDataDirError)
    expect(() => resolveDataRoot('foundry', '/repos/terminator')).toThrow(RelativeDataDirError)
  })

  it('names the offending value in the rejection', () => {
    expect(() => resolveDataRoot('./here', '/repos/terminator')).toThrow(/\.\/here/)
  })

  it('is pure: the same inputs always give the same answer', () => {
    expect(resolveDataRoot('', '/a')).toEqual(resolveDataRoot('', '/a'))
  })

  it('trims surrounding whitespace before deciding', () => {
    expect(resolveDataRoot('  /var/foundry  ', '/repos/x').root).toBe('/var/foundry')
    expect(resolveDataRoot('   ', '/repos/x').usingDefault).toBe(true)
  })
})

describe('paths under the root', () => {
  const root = '/var/foundry'

  it('puts an order in its own directory', () => {
    expect(orderDir(root, 'WO-0913-c71')).toBe('/var/foundry/orders/WO-0913-c71')
  })

  it('puts a unit under its order', () => {
    expect(unitDir(root, 'WO-0913-c71', 'U-2')).toBe('/var/foundry/orders/WO-0913-c71/units/U-2')
  })

  it('names a lane directory by merge order and repository, so it sorts', () => {
    expect(laneDir(root, 'WO-0913-c71', 1, 'api-contracts')).toBe(
      '/var/foundry/orders/WO-0913-c71/lanes/1-api-contracts'
    )
  })
})

describe('ensureWritable', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-root-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('creates the root when it does not exist yet', async () => {
    const root = path.join(tmp, 'nested', 'foundry')
    const r = await ensureWritable(root)
    expect(r.ok).toBe(true)
    expect(fs.existsSync(root)).toBe(true)
  })

  it('accepts a root that already exists', async () => {
    expect((await ensureWritable(tmp)).ok).toBe(true)
  })

  it('reports a root it cannot create, naming the path', async () => {
    const wall = path.join(tmp, 'wall')
    fs.mkdirSync(wall)
    fs.chmodSync(wall, 0o500)
    const r = await ensureWritable(path.join(wall, 'foundry'))
    fs.chmodSync(wall, 0o700)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain(path.join(wall, 'foundry'))
  })

  it('reports a root that exists but is a file, rather than trying to write into it', async () => {
    const file = path.join(tmp, 'not-a-dir')
    fs.writeFileSync(file, 'x')
    const r = await ensureWritable(file)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/not a directory/i)
  })
})

// This took whatever it was given and built the directories to match. A live
// run filed its `ship.draft_opened` entry by the entry's *subject* — a pull
// request URL — and produced
// `orders/https:/github.com/owner/repo/pull/8/ledger.jsonl`, while the order's
// own ledger never mentioned the draft it had just opened. The caller was
// wrong and is fixed; the shape is refused as well, because a silent misfile
// is how it went unnoticed: the write succeeded and nothing said where it went.
describe('an order id that does not name an order', () => {
  it('refuses a URL, which is what a live run passed it', () => {
    expect(() => orderDir('/data', 'https://github.com/owner/repo/pull/8')).toThrow(
      OrderIdEscapesRootError
    )
  })

  it('refuses a traversal', () => {
    expect(() => orderDir('/data', '../elsewhere')).toThrow(OrderIdEscapesRootError)
    expect(() => orderDir('/data', 'a/b')).toThrow(OrderIdEscapesRootError)
  })

  it('refuses an absolute path, which would ignore the root entirely', () => {
    expect(() => orderDir('/data', '/etc')).toThrow(OrderIdEscapesRootError)
  })

  it('accepts the ids that actually exist', () => {
    expect(orderDir('/data', 'WO-1')).toBe(path.join('/data', 'orders', 'WO-1'))
    expect(orderDir('/data', 'TEAM-123')).toBe(path.join('/data', 'orders', 'TEAM-123'))
    expect(orderDir('/data', 'WO-LIVE-RUN')).toBe(path.join('/data', 'orders', 'WO-LIVE-RUN'))
  })
})
