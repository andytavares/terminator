import { describe, it, expect } from 'vitest'
import { decideTool } from '../../src/runtime/tool-decision.js'
import type { ToolRequest } from '../../src/runtime/tool-decision.js'

// The decision an agent's tool call actually meets. It lived inline in
// `activate`, where the only tests that could reach it grepped the source for
// substrings — every test that mentions `autoDecide` passes a stub, so they
// cover the bridge that carries a decision and never the decision itself.
//
// Four live failures came from this one composition, and none of them was
// visible to a green suite.

function request(over: Partial<ToolRequest> = {}): ToolRequest {
  return {
    tool: 'Bash',
    input: { command: 'ls' },
    readOnly: false,
    role: 'builder',
    mayUseTool: () => true,
    isProbed: () => false,
    readOnlyTools: [],
    autonomy: 'standard',
    worktreePath: '/work/checkout',
    ...over,
  }
}

describe('a role that may not write', () => {
  const reviewing = (over: Partial<ToolRequest> = {}) =>
    decideTool(request({ readOnly: true, role: 'verifier', ...over }))

  it('answers an allowed command itself rather than asking a person', () => {
    // `null` here sent the call to the operator, where it sat for the
    // five-minute hold before falling back. Six tool calls was half an hour of
    // waiting, and the console showed an agent thinking.
    expect(reviewing({ input: { command: 'git status' } })).toEqual({
      allow: true,
      reason: expect.any(String),
    })
  })

  it('answers a refused one itself too, with the reason', () => {
    const decision = reviewing({ input: { command: 'rm -rf build' } })
    expect(decision?.allow).toBe(false)
    expect(decision?.reason).toContain('rm')
  })

  it("runs the project's own command when its role declared run_tests", () => {
    // FR-033 asks the verifier for a verdict from an exit status, and the
    // read-only policy refuses `npm test` like any other unknown binary.
    const decision = reviewing({
      input: { command: 'npm test' },
      mayUseTool: (tool) => tool === 'run_tests',
      isProbed: () => true,
    })
    expect(decision?.allow).toBe(true)
  })

  it("refuses the project's own command to a role that never declared it", () => {
    const decision = reviewing({
      input: { command: 'npm test' },
      mayUseTool: () => false,
      isProbed: () => true,
    })
    expect(decision?.allow).toBe(false)
  })

  it('uses a tool the operator listed as read-only', () => {
    // An architect was refused a documentation lookup and wrote "Environment
    // is read-only for execution and MCP, so I could not pull Node docs. That
    // shapes what I can claim."
    const decision = reviewing({
      tool: 'mcp__docs__query',
      input: { question: 'how does x work' },
      readOnlyTools: ['mcp__docs__query'],
    })
    expect(decision?.allow).toBe(true)
  })

  it('refuses the same tool when the operator listed nothing', () => {
    // Deny-by-default stays: a name is not a contract about writing.
    const decision = reviewing({ tool: 'mcp__docs__query', input: {} })
    expect(decision?.allow).toBe(false)
  })

  it('never abstains, whatever it decides', () => {
    for (const command of ['git status', 'rm -rf x', 'npm test', 'find . -delete']) {
      expect(reviewing({ input: { command } }), command).not.toBeNull()
    }
  })
})

describe('a role that writes', () => {
  it('is refused a class of tool its role file does not list', () => {
    const decision = decideTool(
      request({
        tool: 'Write',
        input: { file_path: '/work/checkout/x.ts' },
        mayUseTool: () => false,
      })
    )
    expect(decision?.allow).toBe(false)
    expect(decision?.reason).toContain('builder')
  })

  it('takes ordinary work without asking, which is what lights-out means', () => {
    const decision = decideTool(
      request({ tool: 'Edit', input: { file_path: '/work/checkout/src/a.ts' } })
    )
    expect(decision?.allow).toBe(true)
  })

  it('takes an ordinary compound command', () => {
    // These went to an operator at every setting, so no run finished
    // unattended and builders sat while the graph said `running`.
    for (const command of ['pwd && git status', 'npm test 2>&1 | tail -20', 'cd "$(pwd)" && ls']) {
      expect(decideTool(request({ input: { command } }))?.allow, command).toBe(true)
    }
  })

  it('never takes a destructive action, at any setting', () => {
    // The rule is "never automatically", not "always by asking". Where somebody
    // can be asked, it asks; where nobody can — `lights-out` — it refuses and
    // says why. The action does not happen either way, which is the whole point.
    expect(decideTool(request({ input: { command: 'git reset --hard' } }))).toBeNull()
    expect(
      decideTool(request({ input: { command: 'git reset --hard' }, autonomy: 'lights-out' }))?.allow
    ).toBe(false)
  })

  it('asks about a write outside its own checkout', () => {
    expect(decideTool(request({ tool: 'Edit', input: { file_path: '/etc/hosts' } }))).toBeNull()
  })

  it('asks about everything at escorted, which is what the setting means', () => {
    expect(
      decideTool(
        request({ tool: 'Edit', input: { file_path: '/work/checkout/a.ts' }, autonomy: 'escorted' })
      )
    ).toBeNull()
  })

  it('judges a bare command with no role by the autonomy setting alone', () => {
    // A ladder rung answers to no role's tool list.
    const decision = decideTool(
      request({ role: null, mayUseTool: () => false, input: { command: 'npm test' } })
    )
    expect(decision?.allow).toBe(true)
  })
})

describe('the order the four checks run in', () => {
  it('lets the run_tests allowance beat the read-only policy', () => {
    const decision = decideTool(
      request({
        readOnly: true,
        role: 'verifier',
        input: { command: 'npm test' },
        mayUseTool: (tool) => tool === 'run_tests',
        isProbed: () => true,
      })
    )
    expect(decision?.allow).toBe(true)
  })

  it('lets the read-only policy beat the autonomy setting', () => {
    // A reviewer at lights-out is still a reviewer.
    const decision = decideTool(
      request({
        readOnly: true,
        role: 'verifier',
        input: { command: 'rm -rf x' },
        autonomy: 'lights-out',
      })
    )
    expect(decision?.allow).toBe(false)
  })

  it("lets the role's tool list beat the autonomy setting", () => {
    const decision = decideTool(
      request({
        tool: 'Write',
        input: { file_path: '/work/checkout/a.ts' },
        mayUseTool: () => false,
        autonomy: 'lights-out',
      })
    )
    expect(decision?.allow).toBe(false)
  })
})

// At `lights-out` a question has nobody to answer it. Asking is right whenever
// somebody is there; when nobody is, the held call goes to the operator, then
// five minutes later to the runtime's own prompt in the terminal, and the agent
// stands at that prompt until the wall-clock budget ends the run. Measured on a
// live run: the builder redirected its test output to a scratch file — outside
// the checkout, and so worth a question — and thirty minutes later the order
// had shipped nothing.
describe('a question with nobody to answer it', () => {
  const unattended = (over: Partial<ToolRequest> = {}) =>
    decideTool(request({ autonomy: 'lights-out', ...over }))

  it('refuses instead of waiting, for a write outside the checkout', () => {
    const decision = unattended({ tool: 'Edit', input: { file_path: '/etc/hosts' } })
    expect(decision).not.toBeNull()
    expect(decision?.allow).toBe(false)
  })

  it('refuses instead of waiting, for something destructive', () => {
    const decision = unattended({ input: { command: 'git reset --hard' } })
    expect(decision?.allow).toBe(false)
  })

  it('says why, in words the agent can act on', () => {
    // A reason an agent cannot do anything with wastes the turn it was given
    // to adapt. This one names the alternative.
    const decision = unattended({
      input: { command: 'npm test > /tmp/scratch/out.log' },
    })
    expect(decision?.reason).toContain('unattended')
    expect(decision?.reason).toContain('inside the worktree')
  })

  it('is exactly as strict as the wait it replaces — nothing new is allowed', () => {
    // The whole safety argument in one assertion: everything that used to be
    // held is now refused, and nothing that used to be held is now permitted.
    const held = [
      { tool: 'Edit', input: { file_path: '/etc/hosts' } },
      { tool: 'Bash', input: { command: 'git reset --hard' } },
      { tool: 'Bash', input: { command: 'rm -rf build' } },
      { tool: 'Bash', input: { command: 'echo $(' } },
      { tool: 'Bash', input: { command: 'npm test > /tmp/out.log' } },
    ]
    for (const call of held) {
      expect(
        decideTool(request({ ...call, autonomy: 'standard' })),
        JSON.stringify(call)
      ).toBeNull()
      const unattendedDecision = decideTool(request({ ...call, autonomy: 'lights-out' }))
      expect(unattendedDecision?.allow, JSON.stringify(call)).toBe(false)
    }
  })

  it('still asks when somebody is there to be asked', () => {
    for (const autonomy of ['standard', 'escorted'] as const) {
      expect(
        decideTool(request({ tool: 'Edit', input: { file_path: '/etc/hosts' }, autonomy })),
        autonomy
      ).toBeNull()
    }
  })

  it('leaves ordinary work alone — it was never a question', () => {
    expect(
      unattended({ tool: 'Edit', input: { file_path: '/work/checkout/src/a.ts' } })?.allow
    ).toBe(true)
    expect(unattended({ input: { command: 'npm test 2>&1 | tail -20' } })?.allow).toBe(true)
  })
})
