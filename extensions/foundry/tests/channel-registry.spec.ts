import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

// Every channel is registered once.
//
// The host refuses a second handler for the same name by throwing, and that
// throw happens inside `activate` — so one duplicated line does not break one
// channel, it stops the whole extension loading. Nothing else catches it: the
// build succeeds, every unit test passes, and the extension is simply absent
// from the application.
//
// A duplicate `reg()` did exactly that, and the only thing that noticed was a
// screenshot with no Foundry button in it.

const here = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(here, '..', 'src', 'index.ts'), 'utf8')

const contract = fs.readFileSync(
  path.join(
    here,
    '..',
    '..',
    '..',
    'specs',
    '037-foundry-software-factory',
    'contracts',
    'ipc-channels.md'
  ),
  'utf8'
)

function registered(): string[] {
  return [...src.matchAll(/reg\(api,\s*'([^']+)'/g)].map((m) => m[1])
}

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

describe('the channel registry', () => {
  it('registers every channel exactly once', () => {
    const names = registered()
    const seen = new Map<string, number>()
    for (const name of names) seen.set(name, (seen.get(name) ?? 0) + 1)
    const twice = [...seen].filter(([, n]) => n > 1).map(([name]) => name)

    expect(twice, `registered more than once: ${twice.join(', ')}`).toEqual([])
  })

  it('registers something at all, so this test cannot pass by finding nothing', () => {
    expect(registered().length).toBeGreaterThan(20)
  })

  // Constitution VIII: the contract ships with the code. It said "ten
  // channels" while forty-three were registered, and thirty of them were
  // documented nowhere — a contract nobody could use to answer "what does this
  // extension expose".
  it('documents every channel it registers', () => {
    const undocumented = registered().filter((name) => !contract.includes(name))
    expect(undocumented, `not in the IPC contract: ${undocumented.join(', ')}`).toEqual([])
  })

  it('names every channel under this extension prefix', () => {
    for (const name of registered()) {
      expect(name.startsWith('foundry:'), `${name} is not a foundry channel`).toBe(true)
    }
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
    const turnEnd = src.slice(src.indexOf('onTurnEnd: (turns) =>'))
    const body = turnEnd.slice(0, turnEnd.indexOf('\n          },'))
    expect(body, 'the Line waits for onEnd, which a live session never reaches').toContain(
      'finish('
    )
  })

  it('still resolves on the process exiting, for the runs that do exit', () => {
    expect(src).toMatch(/onEnd: \(exitCode\) => \{[\s\S]{0,400}?finish\(exitCode\)/)
  })

  it('takes the turn end as "it stopped", never as "it was right"', () => {
    // FR-033: the producing agent's own account is not evidence. A turn that
    // ended is not a unit that passed — the verifier and the ladder say that.
    const turnEnd = src.slice(src.indexOf('onTurnEnd: (turns) =>'))
    expect(turnEnd.slice(0, 900)).toMatch(/verifier|ladder|FR-033/)
  })
})

// A read-only role exists to decide without a person — that is why the policy
// reads the command rather than the tool. Returning `null` for an *allowed*
// command abstains, and an abstention is a held tool call: five minutes on the
// inbox before it falls back to the terminal. Six calls was half an hour of
// waiting while the console showed an agent thinking.
//
// Only the running application can show this, so what stops it coming back is
// the shape of the source.
// The Line's decision is `runtime/tool-decision.ts` now, with a spec that
// exercises it rather than grepping for it — these assertions existed only
// because it was inline in `activate` and nothing could reach it. What is left
// here is intake's own path, which is still inline and much simpler: read-only,
// plus the one file the architect is allowed to write.
describe('what a read-only role is told, on the intake path', () => {
  it('never abstains on a command its own policy allowed', () => {
    expect(src, 'an allowed read-only command is being sent to the operator').not.toMatch(
      /decision\.allow \? null/
    )
  })

  it('answers with the policy decision, both ways', () => {
    const answers = [
      ...src.matchAll(/return \{ allow: decision\.allow, reason: decision\.reason \}/g),
    ]
    expect(answers.length, 'the intake path does not return its own decision').toBe(1)
  })

  it('hands the run path to the function that can be tested', () => {
    expect(src).toContain('decideTool({')
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
    expect(src).toContain('readOnlyTools: readOnlyTools(api)')
  })

  it('is a declared setting, so there is somewhere to declare it', () => {
    expect(src).toContain("'terminator.foundry.readOnlyTools'")
  })

  it('reads the list rather than guessing from a name', () => {
    const fn = src.slice(src.indexOf('function readOnlyTools'))
    const body = fn.slice(0, fn.indexOf('\n}'))
    expect(body).toContain("get<string>('terminator.foundry.readOnlyTools')")
    expect(body).not.toMatch(/startsWith\('mcp__'\)|includes\('get_'\)|\/read|search\//)
  })
})

// The verifier's whole job is a verdict from an exit status (FR-033), and its
// role file declares `run_tests`. The read-only policy refused `npm test` like
// any other unknown binary — so the role vocabulary said one thing and the gate
// did another, and a live architect burned three turns discovering it.
describe("running the project's own commands", () => {
  it('lets a role that declared run_tests run them', () => {
    // The rule itself lives in `tool-decision.ts` and is exercised there; what
    // this file can still say is that the run path is wired to ask.
    expect(src).toContain('isProbed: (name, given) => isProbedCommand(order, name, given)')
  })

  it('matches them exactly, rather than by prefix', () => {
    const fn = src.slice(src.indexOf('function isProbedCommand'))
    const body = fn.slice(0, fn.indexOf('\n}'))
    // Exact set membership, per segment. A prefix match would let
    // `npm test; rm -rf .` in on the strength of its first two words, which is
    // the whole reason this assertion exists.
    expect(body).toContain('probed.has(segment)')
    expect(body).not.toMatch(/startsWith|includes\(asked\)/)
  })

  it('reads a joined command per segment, so capturing an exit status is allowed', () => {
    // A verdict from an exit status is the verifier's job, and an exit status
    // is something you have to ask for: `npm test; echo "EXIT=$?"`. A
    // whole-command match refused that, naming `npm` as not on the list.
    const fn = src.slice(src.indexOf('function isProbedCommand'))
    const body = fn.slice(0, fn.indexOf('\n}'))
    expect(body).toContain('readShell(command).segments')
    // And every other segment still has to stand on its own, or
    // `npm test; rm -rf .` rides in behind the one that was declared.
    expect(body).toContain("decideReadOnly('Bash', { command: segment }).allow")
  })

  it('only ever considers a shell call', () => {
    const fn = src.slice(src.indexOf('function isProbedCommand'))
    expect(fn.slice(0, fn.indexOf('\n}'))).toContain("tool !== 'Bash'")
  })
})
