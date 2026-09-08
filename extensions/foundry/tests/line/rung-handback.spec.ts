import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execute } from '../../src/line/executor.js'
import type { StartedRun } from '../../src/line/executor.js'
import { buildRunGraph } from '../../src/line/run-graph.js'
import { parseRecipe } from '../../src/recipe/parse.js'
import { createRoleRegistry } from '../../src/line/roles.js'
import { collectableWrites, readRungOutput } from '../../src/line/rung-output.js'
import { decideTool } from '../../src/runtime/tool-decision.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'

// The whole chain, with the real role files and the real policy.
//
// Every piece of this had a unit test and the feature still did nothing,
// because the pieces were never joined: the brief named no destination, the
// policy refused every channel an agent invented, and nothing read a rung's
// result past its exit status. So this drives it end to end — the brief a real
// role is given, an agent that does what the brief says, the decision its
// write actually meets, and the order that comes out the other side.
//
// It stops one seam short of Electron: `index.ts` builds `collect` from
// exactly these three calls, and cannot be imported without a host.

const builtInDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const RECIPE = `
schemaVersion: 1
id: direct
steps:
  - id: scout
    kind: agent
    role: scout
  - id: challenge
    kind: agent
    role: red-team
    after: [scout]
  - id: build
    kind: fanout
    over: plan.units
    after: [challenge]
    step: { kind: agent, role: builder }
`

let dataRoot: string
let repo: string

beforeEach(() => {
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-handback-'))
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-handback-repo-'))
})

afterEach(() => {
  for (const d of [dataRoot, repo]) {
    fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})

function recipe() {
  const parsed = parseRecipe(RECIPE, 'direct.yaml')
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.value
}

function order(): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'Make all text red',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: [repo],
    now: '2026-09-08T01:00:00.000Z',
  })
  return {
    ...base,
    status: 'agreed',
    agreedAt: '2026-09-08T01:30:00.000Z',
    acceptance: [
      {
        id: 'AC-1',
        statement: 'every glyph is red',
        priority: 'P1',
        verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
        unverifiable: null,
      },
    ],
    plan: {
      ...base.plan,
      units: [
        {
          id: 'U-1',
          title: 'the token layer',
          role: 'builder',
          lane: 1,
          dependsOn: [],
          satisfies: ['AC-1'],
          touches: ['src/renderer/styles.css'],
          verify: [],
        },
      ],
    },
  }
}

describe('a rung handing back what it found, end to end', () => {
  /**
   * The whole of `index.ts`'s `collect`, over a real role registry.
   *
   * Written out rather than mocked, because a stub here would prove the shape
   * of a call and not the behaviour — which is exactly how twelve mechanisms
   * once passed their tests while being called by nothing.
   */
  function collectorFor(sources: {
    dataRoot: string
    repoPaths: readonly string[]
    builtInDir: string
  }) {
    const roles = createRoleRegistry(sources)
    let saved: WorkOrder | null = null
    return {
      saved: () => saved,
      collect: async (input: { nodeId: string; role: string; outputPath: string }) => {
        const result = readRungOutput({
          order: saved ?? order(),
          role: input.role,
          writes: collectableWrites(roles.get(input.role)),
          outputPath: input.outputPath,
          at: '2026-09-08T02:00:00.000Z',
        })
        if (result === null || !result.ok) return null
        saved = result.order
        return { order: result.order, note: result.note, defect: result.defect }
      },
    }
  }

  it("carries the scout's findings into the brief of the rung after it", async () => {
    const sources = { dataRoot, repoPaths: [repo], builtInDir }
    const collector = collectorFor(sources)
    const roles = createRoleRegistry(sources)
    const prompts = new Map<string, string>()

    // An agent that does exactly what its brief says, and nothing else: it
    // finds the path in the contract and writes the JSON the contract shows.
    const agent = async (input: {
      node: { id: string }
      role: string | null
      prompt: string
      readOnly: boolean
      outputPath: string | null
    }): Promise<StartedRun> => {
      prompts.set(input.node.id, input.prompt)

      if (input.outputPath !== null) {
        // The write the agent is about to make, put through the decision it
        // would actually meet. A refusal here is the live defect: an agent
        // told to write a file it is not allowed to write.
        const decision = decideTool({
          tool: 'Write',
          input: { file_path: input.outputPath, content: '{}' },
          readOnly: input.readOnly,
          role: input.role,
          mayUseTool: (tool) => input.role === null || roles.mayUseTool(input.role, tool),
          isProbed: () => false,
          readOnlyTools: [],
          autonomy: 'lights-out',
          worktreePath: repo,
          outputPath: input.outputPath,
        })
        expect(decision, `${input.node.id} was refused its own output file`).toEqual({
          allow: true,
          reason: expect.any(String),
        })

        fs.mkdirSync(path.dirname(input.outputPath), { recursive: true })
        fs.writeFileSync(
          input.outputPath,
          JSON.stringify(
            input.node.id === 'scout'
              ? {
                  findings: {
                    entryPoints: ['src/renderer/styles.css'],
                    conventions: ['colour lives in tokens, never a literal hex'],
                  },
                  note: 'four colour authorities, not one',
                }
              : { note: 'nothing to add' }
          )
        )
      }

      return { sessionId: `sess-${input.node.id}`, exitCode: 0 }
    }

    const o = order()
    await execute(o, recipe(), buildRunGraph(o, recipe()), {
      run: agent as never,
      now: () => '2026-09-08T02:00:00.000Z',
      sources,
      autonomy: 'lights-out',
      runStep: async () => 0,
      collect: collector.collect,
    })

    // The contract reached the scout, at a path under this order.
    expect(prompts.get('scout')).toContain('What to write, and where')
    expect(prompts.get('scout')).toContain(path.join(dataRoot, 'orders', 'WO-1', 'rungs'))

    // What it wrote is on the order…
    expect(collector.saved()?.context.entryPoints).toEqual(['src/renderer/styles.css'])

    // …and, the part that was missing entirely, in the brief of the rung after
    // it. `applyProposal` says in as many words that "Scout runs after
    // agreement, which is too late to inform one" — the design had already
    // worked around a channel that simply did not exist.
    expect(prompts.get('build:U-1')).toContain('colour lives in tokens, never a literal hex')

    // And the file does not survive to be read as the next turn's answer.
    expect(fs.existsSync(path.join(dataRoot, 'orders', 'WO-1', 'rungs', 'scout.json'))).toBe(false)
  })

  it('stops the run when a rung says the order it is building from is wrong', async () => {
    const sources = { dataRoot, repoPaths: [repo], builtInDir }
    const collector = collectorFor(sources)

    const agent = async (input: {
      node: { id: string }
      outputPath: string | null
    }): Promise<StartedRun> => {
      if (input.node.id === 'challenge' && input.outputPath !== null) {
        fs.mkdirSync(path.dirname(input.outputPath), { recursive: true })
        fs.writeFileSync(
          input.outputPath,
          JSON.stringify({
            redTeam: [
              { severity: 'high', text: 'AC-1 cannot be falsified: "red" names no measurement.' },
            ],
            note: 'the only criterion is unverifiable',
          })
        )
      }
      return { sessionId: `sess-${input.node.id}`, exitCode: 0 }
    }

    const o = order()
    const outcome = await execute(o, recipe(), buildRunGraph(o, recipe()), {
      run: agent as never,
      now: () => '2026-09-08T02:00:00.000Z',
      sources,
      autonomy: 'standard',
      runStep: async () => 0,
      collect: collector.collect,
      raise: async () => {},
    })

    // The finding is on the order, where the structural pass puts its own.
    expect(collector.saved()?.redTeam[0]?.text).toContain('cannot be falsified')

    // It reached a person, under the rule for an order that contradicts
    // itself — which was declared, rendered in the Inbox, and raised by
    // nothing at all before this.
    const gate = outcome.gates.find((g) => g.rule === 'forge-defect')
    expect(gate?.why).toContain('cannot be falsified')

    // And the builder did not start on an order a reader has just said is
    // wrong, which is what happened on the live run this came from.
    expect(outcome.graph.nodes.find((n) => n.id === 'build:U-1')?.state).toBe('waiting')
  })
})
