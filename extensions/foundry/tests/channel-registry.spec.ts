import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
// The modules `activate` composes, read as one text: what these specs look for
// lives in whichever of them owns it.
const src = [
  'index.ts',
  'workspace-root.ts',
  'state/settings.ts',
  'state/settings-schema.ts',
  'runtime/agent-policy.ts',
  'runtime/held-calls.ts',
  'runtime/supervision-runtime.ts',
  'line/executor-deps.ts',
  'line/node-session.ts',
  'line/ship-deps.ts',
  'line/execute-run.ts',
  'forge/intake-turn.ts',
  'ipc/inbox-registration.ts',
  'ipc/ui-registration.ts',
]
  .map((file) => fs.readFileSync(path.join(here, '..', 'src', file), 'utf8'))
  .join('\n')

/** Every setting key the extension declares to the host. */
function declaredSettings(): string[] {
  return [...new Set([...src.matchAll(/'(terminator\.foundry\.[^']+)':\s*\{/g)].map((m) => m[1]))]
}

// A setting nothing reads is a control the operator can move while the factory
// ignores it. Thirty-three of them shipped: ten notification kinds carried over
// from the retired extension ("Could not start queued card"), three budgets,
// the critical-path list, a duplicate concurrency limit and a log retention
// nothing pruned. Every one had a label, a default and a place in the settings
// panel, and none of them did anything.
describe('the settings surface', () => {
  it('reads every setting it registers', () => {
    const unread = declaredSettings().filter((key) => {
      // The declaration itself is `'key': {`; a read is the same string
      // anywhere else — `settings.get('key')` or `settings.set('key', …)`.
      const occurrences = src.split(`'${key}'`).length - 1
      return occurrences < 2
    })
    expect(unread, `registered but read by nothing: ${unread.join(', ')}`).toEqual([])
  })

  it('declares something at all, so this test cannot pass by finding nothing', () => {
    expect(declaredSettings().length).toBeGreaterThan(5)
  })
})

// A node is over when its *turn* is over, not when its process is.
//
// A supervised session sits at its prompt after answering — that is the point
// of running it in a terminal you can type into — so a `runNode` that resolves
// only on `onEnd` waits for something that never happens. The Line could not
// complete a single agent node, while intake, which has always treated a turn
// end as the answer, worked fine.
//
// Nothing below the application can see this: every unit test hands the
// executor a `run` that resolves. The live e2e is what proves it, and this is
// what stops it being undone between live runs.
describe('what ends a node', () => {
  it('resolves the Line on a turn ending, not only on the process exiting', () => {
    const turnEnd = src.slice(src.indexOf('function finishNodeTurn('))
    const body = turnEnd.slice(0, turnEnd.indexOf('\n}'))
    expect(body, 'the Line waits for onEnd, which a live session never reaches').toContain(
      'finish('
    )
  })

  it('still resolves on the process exiting, for the runs that do exit', () => {
    expect(src).toMatch(
      /function archiveEndedSession\([^)]*\): void \{[\s\S]{0,400}?finish\(exitCode\)/
    )
  })

  it('takes the turn end as "it stopped", never as "it was right"', () => {
    // FR-033: the producing agent's own account is not evidence. A turn that
    // ended is not a unit that passed — the verifier and the ladder say that.
    const turnEnd = src.slice(src.indexOf('function finishNodeTurn('))
    expect(turnEnd.slice(0, 900)).toMatch(/verifier|ladder|FR-033/)
  })
})

// A refusal was posted to the console and a *question* was not, so an agent
// waiting on one looked exactly like an agent that had gone quiet — which is
// what it then became. Watched live: a builder redirected its test output to a
// scratch file outside the checkout, FR-050 asked about it, nobody was there,
// the bridge handed the call back to the terminal's own prompt five minutes
// later, and the run sat until the wall-clock budget ended it half an hour on.
// Nothing anywhere said a question had been asked.
describe('a question nobody is there to answer', () => {
  it('says an agent is waiting on one', () => {
    expect(src).toContain('asked about ${pending.toolName}')
  })

  it('says when it went to the terminal prompt instead, which is where it stops', () => {
    expect(src).toContain("outcome === 'handback'")
    expect(src).toContain('an agent waits there')
  })
})

// The stall detector is timely and nothing consumes it. Measured on a live run:
// the builder fell silent at 07:27:08, the detector fired at 07:34:21, and the
// run waited until the wall-clock budget stopped it at 07:52:10 — eighteen
// minutes after the console already knew. The executor is not told and shadow
// mode is on by default, so those eighteen minutes left no trace anywhere an
// operator reads afterwards: the ledger said "budget exceeded", which is true
// and explains nothing.
describe('a stall, where the order is read', () => {
  it('goes on the order ledger and not only the console feed', () => {
    expect(src).toContain('inBackground(recordStall(featureDir, firing))')
    const fn = src.slice(src.indexOf('async function recordStall'))
    const body = fn.slice(0, fn.indexOf('\n}'))
    expect(body).toContain("action: 'run.stalled'")
  })

  it('refuses to invent a place for a firing that is not an order', () => {
    const fn = src.slice(src.indexOf('async function recordStall'))
    const body = fn.slice(0, fn.indexOf('\n}'))
    expect(body).toContain('orderDir(root, orderId)')
  })

  it('says the work is still there, because it is', () => {
    const fn = src.slice(src.indexOf('async function recordStall'))
    expect(fn.slice(0, fn.indexOf('\n}'))).toContain('nothing was thrown away')
  })
})

// A shipping entry's subject is whatever the entry is about: the order for
// `ship.ready_asked`, and the pull request **URL** for `ship.draft_opened`.
// Filing the entry by its subject sent the most important record the feature
// writes to a ledger named after a URL, and built the directories to match —
// watched on a live run that opened a real draft:
//
//   .foundry/orders/https:/github.com/owner/repo/pull/8/ledger.jsonl
//
// The order's own ledger never mentioned the draft it had just opened.
describe('which ledger a shipping entry goes in', () => {
  it('files by the order, not by whatever the entry is about', () => {
    const fn = src.slice(src.indexOf('function integrateDepsFor'))
    const body = fn.slice(0, fn.indexOf('\n}'))
    expect(body).toContain('orderId,')
    expect(body).not.toContain('orderId: subject')
  })

  it('is told which order, at both call sites', () => {
    expect(src).toContain('integrateDepsFor(api, root, order.id)')
    expect(src).toContain('integrateDepsFor(api, dataRoot(), gate.orderId)')
  })
})

// The read-only policy refuses any tool it has not been taught about, which is
// right: an MCP server's tools are named by somebody else, and
// `mcp__x__get_thing` and `mcp__x__delete_thing` are the same shape to anything
// reading names. The cost is real, though — watched live, an architect tried to
// check a technique against the documentation, was refused, and wrote
// "Environment is read-only for execution and MCP, so I could not pull Node
// docs. That shapes what I can claim." So the operator names them, and Foundry
// still infers nothing.
describe('tools the operator says only read', () => {
  it('is passed to the decision, so it can be consulted at all', () => {
    expect(src).toContain('readOnlyTools: readOnlyTools(api, checkout.origin)')
  })

  it('is a declared setting, so there is somewhere to declare it', () => {
    expect(src).toContain("'terminator.foundry.readOnlyTools'")
  })

  it('reads the list rather than guessing from a name', () => {
    const fn = src.slice(src.indexOf('function readOnlyTools'))
    const body = fn.slice(0, fn.indexOf('\n}'))
    expect(body).toContain("get<string[]>('terminator.foundry.readOnlyTools', { repoPath })")
    expect(body).not.toMatch(/startsWith\('mcp__'\)|includes\('get_'\)|\/read|search\//)
  })
})
