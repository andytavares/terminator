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
describe('what a read-only role is told', () => {
  it('never abstains on a command its own policy allowed', () => {
    expect(src, 'an allowed read-only command is being sent to the operator').not.toMatch(
      /decision\.allow \? null/
    )
  })

  it('answers with the policy decision, both ways', () => {
    const answers = [
      ...src.matchAll(/return \{ allow: decision\.allow, reason: decision\.reason \}/g),
    ]
    expect(answers.length, 'the read-only paths do not return their own decision').toBe(2)
  })
})

// The verifier's whole job is a verdict from an exit status (FR-033), and its
// role file declares `run_tests`. The read-only policy refused `npm test` like
// any other unknown binary — so the role vocabulary said one thing and the gate
// did another, and a live architect burned three turns discovering it.
describe("running the project's own commands", () => {
  it('lets a role that declared run_tests run them', () => {
    expect(src).toContain("input.mayUseTool('run_tests')")
    expect(src).toContain('isProbedCommand(order, tool, toolInput)')
  })

  it('matches them exactly, rather than by prefix', () => {
    const fn = src.slice(src.indexOf('function isProbedCommand'))
    const body = fn.slice(0, fn.indexOf('\n}'))
    expect(body).toContain('found.command.trim() === asked')
    expect(body).not.toMatch(/startsWith|includes\(asked\)/)
  })

  it('only ever considers a shell call', () => {
    const fn = src.slice(src.indexOf('function isProbedCommand'))
    expect(fn.slice(0, fn.indexOf('\n}'))).toContain("tool !== 'Bash'")
  })
})
