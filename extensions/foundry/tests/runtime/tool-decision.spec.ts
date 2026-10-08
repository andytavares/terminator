import { describe, it, expect } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    outputPath: null,
    skillsMount: null,
    letModeDecide: false,
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
      input: { command: 'npm test > /work/other/out.log' },
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
      { tool: 'Bash', input: { command: 'npm test > /work/other/out.log' } },
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

  // The one thing that changed, and the only one. A throwaway under the OS
  // temp directory — where the harness's own system prompt tells the agent to
  // put intermediate files — used to be held as a write outside the checkout,
  // so the agent obeyed its harness and Foundry charged it five minutes a
  // file. It is taken now. Nothing else outside the checkout moved.
  it('takes a scratch file, which is the one thing that used to be held and is not', () => {
    for (const autonomy of ['standard', 'lights-out'] as const) {
      const decision = decideTool(
        request({ input: { command: `npm test > ${join(tmpdir(), 'out.log')}` }, autonomy })
      )
      expect(decision?.allow, autonomy).toBe(true)
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

// A read-only rung has one thing it is allowed to change: the file it hands
// back what it found in. Without it the policy refused every channel the
// agents invented — `cat >`, `sed`, `awk`, then `Write` — and a live run's
// architect lost a complete corrected order to "a review may not redirect
// output" while the builders it had just contradicted were starting.
describe('where a read-only rung hands back what it found', () => {
  const rung = (over: Partial<ToolRequest> = {}) =>
    decideTool(
      request({
        readOnly: true,
        role: 'red-team',
        outputPath: '/data/orders/WO-1/rungs/challenge.json',
        ...over,
      })
    )

  it('lets the rung write its own output file', () => {
    expect(
      rung({ tool: 'Write', input: { file_path: '/data/orders/WO-1/rungs/challenge.json' } })
    ).toEqual({ allow: true, reason: expect.any(String) })
  })

  it('refuses any other file, which is the whole of the permission', () => {
    expect(
      rung({ tool: 'Write', input: { file_path: '/data/orders/WO-1/rungs/plan.json' } })?.allow
    ).toBe(false)
    expect(rung({ tool: 'Write', input: { file_path: '/repo/src/index.ts' } })?.allow).toBe(false)
  })

  it('refuses a shell redirect at the same path', () => {
    // A command string cannot be read as "this writes here and nowhere else",
    // and a policy that tried would be an allowlist with a hole in it. The
    // contract tells the agent to use Write for exactly this reason.
    expect(
      rung({
        tool: 'Bash',
        input: { command: 'echo {} > /data/orders/WO-1/rungs/challenge.json' },
      })?.allow
    ).toBe(false)
  })

  it('grants nothing to a rung with no output of its own', () => {
    expect(
      decideTool(
        request({
          readOnly: true,
          role: 'verifier',
          outputPath: null,
          tool: 'Write',
          input: { file_path: '/anything.json' },
        })
      )?.allow
    ).toBe(false)
  })

  it('does not widen a role that may already write', () => {
    // The permission is an exception to the read-only policy, not a rule of
    // its own: a builder is judged by its role's tool list and the autonomy
    // setting exactly as before.
    expect(
      decideTool(
        request({
          readOnly: false,
          role: 'builder',
          mayUseTool: () => false,
          outputPath: '/data/orders/WO-1/rungs/build.json',
          tool: 'Write',
          input: { file_path: '/data/orders/WO-1/rungs/build.json' },
        })
      )
    ).toEqual({ allow: false, reason: expect.stringContaining('builder') })
  })
})

// The mount a node's skills are copied into and passed to the agent with
// `--add-dir`. Every tool call goes through `decideTool`, and anything it
// does not decide is held for five minutes — so a read of the mount that
// fell through to "ask" would cost the run five minutes for looking at its
// own skill.
describe('a skill mounted for this node', () => {
  const mount = '/data/orders/WO-1/skills'

  it.each(['Read', 'Glob', 'Grep', 'LS'])('allows %s of the mount for a writing role', (tool) => {
    const decision = decideTool(
      request({
        tool,
        input: { file_path: `${mount}/scout.md`, path: `${mount}/scout.md` },
        skillsMount: mount,
      })
    )
    expect(decision).toEqual({ allow: true, reason: expect.any(String) })
  })

  it.each(['Read', 'Glob', 'Grep', 'LS'])('allows %s of the mount for a read-only role', (tool) => {
    const decision = decideTool(
      request({
        readOnly: true,
        role: 'verifier',
        tool,
        input: { file_path: `${mount}/scout.md`, path: `${mount}/scout.md` },
        skillsMount: mount,
      })
    )
    expect(decision).toEqual({ allow: true, reason: expect.any(String) })
  })

  it.each(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])(
    'denies %s inside the mount for a writing role',
    (tool) => {
      const decision = decideTool(
        request({
          tool,
          input: { file_path: `${mount}/scout.md`, notebook_path: `${mount}/scout.md` },
          skillsMount: mount,
        })
      )
      expect(decision?.allow).toBe(false)
      expect(decision?.reason).toContain('read-only')
    }
  )

  it.each(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])(
    'denies %s inside the mount for a read-only role',
    (tool) => {
      const decision = decideTool(
        request({
          readOnly: true,
          role: 'red-team',
          tool,
          input: { file_path: `${mount}/scout.md`, notebook_path: `${mount}/scout.md` },
          skillsMount: mount,
        })
      )
      expect(decision?.allow).toBe(false)
      expect(decision?.reason).toContain('read-only')
    }
  )

  it('does not treat a sibling path with the mount as a string prefix as inside it', () => {
    // Not caught by the mount allowance, so it falls through to the ordinary
    // write rules: outside the checkout, at standard autonomy, that asks.
    // If the prefix check were wrong this would be granted for the mount
    // instead of reaching that ordinary "ask".
    const decision = decideTool(
      request({
        tool: 'Write',
        input: { file_path: `${mount}-other/x.md` },
        skillsMount: mount,
      })
    )
    expect(decision).toBeNull()
  })

  it('does not treat a `..` escape from the mount as inside it', () => {
    // Resolves to /data/orders/WO-1/skills-other/x.md, outside both the mount
    // and the checkout, so this reaches the ordinary "ask" rather than being
    // denied or allowed for the mount.
    const decision = decideTool(
      request({
        tool: 'Write',
        input: { file_path: `${mount}/../skills-other/x.md` },
        skillsMount: mount,
      })
    )
    expect(decision).toBeNull()
  })

  it('changes nothing when the node has no mount', () => {
    expect(
      decideTool(
        request({
          tool: 'Edit',
          input: { file_path: '/work/checkout/src/a.ts' },
          skillsMount: null,
        })
      )?.allow
    ).toBe(true)
  })
})

// Claude Code's auto mode answers what Foundry's own policy has no opinion on,
// instead of the call waiting five minutes for a person and then prompting in
// a terminal nobody is watching.
describe('letting auto mode decide', () => {
  const auto = (over: Partial<ToolRequest> = {}) =>
    decideTool(request({ letModeDecide: true, ...over }))

  it('hands a call the policy has no opinion on to auto mode', () => {
    expect(auto({ tool: 'Edit', input: { file_path: '/etc/hosts' } })).toBe('mode')
    expect(auto({ input: { command: 'npm test > /work/other/out.log' } })).toBe('mode')
  })

  it('does so at lights-out too, where the call was refused', () => {
    expect(auto({ tool: 'Edit', input: { file_path: '/etc/hosts' }, autonomy: 'lights-out' })).toBe(
      'mode'
    )
  })

  // The five calls TAV-15's builder waited on were all of this kind.
  it('hands a destructive action to auto mode as well', () => {
    for (const command of [
      'git add a.ts && node scripts/check-patch-coverage.cjs; echo gate=$?; git reset -q',
      'rm -rf node_modules/electron/dist node_modules/electron/path.txt',
    ]) {
      expect(auto({ input: { command } })).toBe('mode')
      expect(auto({ input: { command }, autonomy: 'lights-out' })).toBe('mode')
    }
  })

  it('still holds a destructive action when auto mode may not decide', () => {
    expect(decideTool(request({ input: { command: 'git reset --hard' } }))).toBeNull()
  })

  it('still asks about everything at escorted, which is what the setting means', () => {
    expect(
      auto({ tool: 'Edit', input: { file_path: '/work/checkout/a.ts' }, autonomy: 'escorted' })
    ).toBeNull()
  })

  it('leaves the decisions the policy does take alone', () => {
    expect(auto({ tool: 'Edit', input: { file_path: '/work/checkout/a.ts' } })).toEqual({
      allow: true,
      reason: expect.any(String),
    })
    expect(
      auto({ readOnly: true, role: 'verifier', input: { command: 'rm -rf x' } })
    ).toMatchObject({ allow: false })
  })
})

describe('a role that writes documentation only', () => {
  const documenting = (file: string, tool = 'Edit') =>
    decideTool(
      request({
        role: 'scribe',
        docsOnly: true,
        tool,
        input: { file_path: file },
        worktreePath: '/work/checkout',
      })
    )

  it('is refused an edit to source, with a reason it can act on', () => {
    const decision = documenting(
      '/work/checkout/src/main/integrations/providers/linear.provider.ts'
    )
    expect(decision).toMatchObject({ allow: false })
    expect((decision as { reason: string }).reason).toContain('documentation only')
  })

  it.each([
    '/work/checkout/docs/x.md',
    '/work/checkout/docs/diagram.svg',
    '/work/checkout/specs/054/plan.txt',
    '/work/checkout/README',
    '/work/checkout/extensions/foundry/CHANGELOG.txt',
    '/work/checkout/notes.md',
  ])('may write %s', (file) => {
    expect(documenting(file)).not.toMatchObject({ allow: false })
  })

  it.each(['Write', 'MultiEdit', 'NotebookEdit'])('refuses %s to source too', (tool) => {
    expect(documenting('/work/checkout/src/a.ts', tool)).toMatchObject({ allow: false })
  })

  it('is refused a path outside the checkout, even a markdown one', () => {
    expect(documenting('/elsewhere/notes.md')).toMatchObject({ allow: false })
  })

  it('is not held to it when the role writes more than documentation', () => {
    const decision = decideTool(
      request({ docsOnly: false, tool: 'Edit', input: { file_path: '/work/checkout/src/a.ts' } })
    )
    expect(decision).not.toMatchObject({ allow: false })
  })
})

describe('where an author may put a document', () => {
  const authoring = (file: string, over: Partial<ToolRequest> = {}) =>
    decideTool(
      request({
        role: 'author',
        docsOnly: true,
        tool: 'Write',
        input: { file_path: file },
        worktreePath: '/work/checkout',
        outputsDir: '/data/orders/WO-1/outputs',
        outputPath: '/data/orders/WO-1/rungs/write.json',
        autonomy: 'lights-out',
        ...over,
      })
    )

  it('may write under the order\u2019s outputs directory, even unattended', () => {
    expect(authoring('/data/orders/WO-1/outputs/answer.md')).toMatchObject({ allow: true })
    expect(authoring('/data/orders/WO-1/outputs/notes/answer.txt')).toMatchObject({ allow: true })
  })

  it('may write its own hand-back file', () => {
    expect(authoring('/data/orders/WO-1/rungs/write.json')).toMatchObject({ allow: true })
  })

  it('may still write documentation in the checkout', () => {
    expect(authoring('/work/checkout/docs/answer.md')).not.toMatchObject({ allow: false })
  })

  it('is refused source in the checkout', () => {
    expect(authoring('/work/checkout/src/a.ts')).toMatchObject({ allow: false })
  })

  it('is refused another order\u2019s outputs and a path that escapes with ..', () => {
    expect(authoring('/data/orders/WO-2/outputs/answer.md')).toMatchObject({ allow: false })
    expect(authoring('/data/orders/WO-1/outputs/../rungs/other.json')).toMatchObject({
      allow: false,
    })
  })

  it('is refused a sibling that only starts with the same letters', () => {
    expect(authoring('/data/orders/WO-1/outputs-old/answer.md')).toMatchObject({ allow: false })
  })

  it('has no outputs to write to when the node was given none', () => {
    expect(
      authoring('/data/orders/WO-1/outputs/answer.md', { outputsDir: null, outputPath: null })
    ).toMatchObject({ allow: false })
  })

  it('does not let a shell command write there', () => {
    expect(
      authoring('/data/orders/WO-1/outputs/answer.md', {
        tool: 'Bash',
        input: { command: 'echo hi > /data/orders/WO-1/outputs/answer.md' },
      })
    ).not.toMatchObject({ allow: true })
  })
})

describe('pushing and opening pull requests', () => {
  const REASON =
    'Foundry pushes the branch and opens the pull request itself; leave both to the line.'
  const refused = { allow: false, reason: REASON }

  it("refuses the scribe's own pull request", () => {
    const command =
      'gh pr create --draft --base main --head foundry/wo-1008-1de --title "git integration: render sanitized HTML in comments and PR descriptions" --body-file "$S/pr-body.md" 2>&1 | tail -3'
    expect(
      decideTool(
        request({ role: 'scribe', docsOnly: true, letModeDecide: true, input: { command } })
      )
    ).toEqual(refused)
  })

  it('refuses a push by a builder', () => {
    expect(
      decideTool(request({ input: { command: 'git push --set-upstream origin HEAD:foundry/x' } }))
    ).toEqual(refused)
  })

  it('refuses a pull request opened in the second segment', () => {
    expect(decideTool(request({ input: { command: 'cd x && gh pr create --draft' } }))).toEqual(
      refused
    )
  })

  it('refuses a pull request from a role that may not write', () => {
    expect(
      decideTool(request({ readOnly: true, role: 'verifier', input: { command: 'gh pr create' } }))
    ).toEqual(refused)
  })

  it.each(['gh pr view 248', 'gh pr checks 248', 'git status', 'echo "gh pr create"'])(
    'does not refuse %s by this rule',
    (command) => {
      const decision = decideTool(request({ input: { command } }))
      expect(decision).not.toEqual(refused)
    }
  )
})
