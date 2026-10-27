import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { builderUnit, testCriterion } from '../helpers/order-parts.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { executePlan as execute } from '../../src/line/executor.js'
import type { ExecutorDeps, StartedRun } from '../../src/line/executor.js'
import { buildRunGraph } from '../../src/line/run-graph.js'
import { idleExecutorSeams } from './idle-executor-seams.js'
import { parseRecipe } from '../../src/recipe/parse.js'
import { createRoleRegistry } from '../../src/line/roles.js'
import { collectableWrites, readRungOutput } from '../../src/line/rung-output.js'
import { roleSettings } from '../../src/runtime/role-settings.js'
import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'
import { makeTempDir } from '../../../../tests/support/temp-dir'
import { writeFileWithDirs } from '../helpers/files.js'

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
  dataRoot = makeTempDir('fdry-handback-')
  repo = makeTempDir('fdry-handback-repo-')
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
    acceptance: [testCriterion('AC-1', { statement: 'every glyph is red' })],
    plan: {
      ...base.plan,
      units: [
        builderUnit('U-1', {
          title: 'the token layer',
          satisfies: ['AC-1'],
          touches: ['src/renderer/styles.css'],
        }),
      ],
    },
  }
}

/** The whole of `index.ts`'s `collect`, over a real role registry. Not mocked: a stub proves the
 * shape of a call, not the behaviour, which is how twelve mechanisms once passed their tests while
 * called by nothing (specs/037-foundry-software-factory/tasks.md, T144). */
function collectorFor(sources: Sources) {
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

interface Sources {
  dataRoot: string
  repoPaths: readonly string[]
  builtInDir: string
}

type Collector = ReturnType<typeof collectorFor>

interface AgentInput {
  node: { id: string }
  role: string | null
  prompt: string
  readOnly: boolean
  outputPath: string | null
}

/** Runs the order to its end over the real roles, with `agent` as every rung. */
function runOrder(
  collector: Collector,
  agent: (input: AgentInput) => Promise<StartedRun>,
  over: Partial<ExecutorDeps> = {}
) {
  const o = order()
  return execute(
    { order: o, recipe: recipe(), graph: buildRunGraph(o, recipe()) },
    {
      ...idleExecutorSeams(),
      onEvent: () => undefined,
      run: agent as never,
      now: () => '2026-09-08T02:00:00.000Z',
      sources: { dataRoot, repoPaths: [repo], builtInDir },
      autonomy: 'lights-out',
      runStep: async () => 0,
      runCommand: async () => 0,
      collect: collector.collect,
      ...over,
    }
  )
}

/** The write the agent is about to make, put through the decision it would actually meet. A refusal
 * here is the live defect: an agent told to write a file it is not allowed to write. */
function expectMayWriteItsOutput(
  input: AgentInput & { outputPath: string },
  roles: ReturnType<typeof createRoleRegistry>
): void {
  const { settings } = roleSettings({
    readOnly: input.readOnly,
    docsOnly: false,
    restrictedWrites: true,
    autonomy: 'lights-out',
    letModeDecide: true,
    outputPath: input.outputPath,
    outputsDir: null,
    skillsMount: null,
    mayUseTool: (tool) => input.role === null || roles.mayUseTool(input.role, tool),
    probedCommands: [],
    readOnlyTools: [],
  })
  const { allow, deny } = settings.permissions
  expect(allow, `${input.node.id} was refused its own output file`).toContain(
    `Write(/${input.outputPath})`
  )
  expect(deny).not.toContain('Write')
}

/** What the scout found in the repository; every other rung has nothing to add. */
const SCOUT_ANSWER = {
  findings: {
    entryPoints: ['src/renderer/styles.css'],
    conventions: ['colour lives in tokens, never a literal hex'],
  },
  note: 'four colour authorities, not one',
}

/** An agent that does exactly what its brief says, and nothing else: it finds the path in the
 * contract and writes the JSON the contract shows. */
function briefFollowingAgent(prompts: Map<string, string>) {
  const roles = createRoleRegistry({ dataRoot, repoPaths: [repo], builtInDir })
  return async (input: AgentInput): Promise<StartedRun> => {
    prompts.set(input.node.id, input.prompt)
    if (input.outputPath !== null) {
      expectMayWriteItsOutput({ ...input, outputPath: input.outputPath }, roles)
      const answer = input.node.id === 'scout' ? SCOUT_ANSWER : { note: 'nothing to add' }
      writeFileWithDirs(input.outputPath, answer)
    }
    return { sessionId: `sess-${input.node.id}`, exitCode: 0 }
  }
}

/** A red team that finds the only criterion cannot be falsified. */
const UNPROVABLE_CHALLENGE = {
  redTeam: [
    {
      severity: 'high',
      category: 'unprovable',
      text: 'AC-1 cannot be falsified: "red" names no measurement.',
    },
  ],
  note: 'the only criterion is unverifiable',
}

/** An agent whose challenge rung says the order is wrong; every other rung writes nothing. */
async function challengingAgent(input: AgentInput): Promise<StartedRun> {
  if (input.node.id === 'challenge' && input.outputPath !== null) {
    writeFileWithDirs(input.outputPath, UNPROVABLE_CHALLENGE)
  }
  return { sessionId: `sess-${input.node.id}`, exitCode: 0 }
}

describe('a rung handing back what it found, end to end', () => {
  it("carries the scout's findings into the brief of the rung after it", async () => {
    const collector = collectorFor({ dataRoot, repoPaths: [repo], builtInDir })
    const prompts = new Map<string, string>()
    await runOrder(collector, briefFollowingAgent(prompts))

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
    const collector = collectorFor({ dataRoot, repoPaths: [repo], builtInDir })
    const outcome = await runOrder(collector, challengingAgent, {
      autonomy: 'standard',
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
