import * as path from 'node:path'
import { stepFor, wantsFreshContext } from './run-graph.js'
import type { RunNode } from './run-graph.js'
import { resolveCommand } from '../recipe/step-kinds.js'
import { mountSkills } from './skills-mount.js'
import { resolveSkills } from '../recipe/resolve.js'
import type { Step } from '../recipe/parse.js'
import { promptFor, safeFilename, skillsFor } from './execution-parts.js'
import type { Execution } from './execution.js'
import type { ExecutorDeps, StartedRun } from './executor.js'
import { inBackground } from '../background.js'

// Starting one node of a wave: a command run as a command, anything else as an
// agent in the conversation its role may carry on, with its skills mounted.

/** A node that ran, and what the rest of the run needs to know about how. */
export interface Ran {
  readonly node: RunNode
  readonly result: StartedRun
  readonly roleId: string | null
  readonly readOnly: boolean
  readonly outputPath: string | null
  /** The command it ran, for a `run` step. */
  readonly command: string | null
  /** Where a command's output went, or null for an agent. */
  readonly logPath: string | null
}

/** A command this repository's toolchain could not resolve, so it never ran. */
interface Skipped {
  readonly node: RunNode
  readonly skipped: true
  readonly skipReason: string
}

export type Launched = Ran | Skipped

// A `run` step that is not a slash instruction runs as a command, so it can fail:
// handed to an agent it always reported exit 0. A slash command such as
// `/speckit-plan` is an agent instruction and still goes to `deps.run`.
export function launchNode(run: Execution, node: RunNode): Promise<Launched> {
  const step = stepFor(run.recipe, node)
  if (
    step?.kind === 'run' &&
    step.command !== undefined &&
    !step.command.trimStart().startsWith('/')
  ) {
    return runCommandNode(run, node, step.command)
  }
  return runAgentNode(run, node, step)
}

async function runCommandNode(run: Execution, node: RunNode, command: string): Promise<Launched> {
  const { deps, order } = run
  const resolved = resolveCommand(command, order)
  if (resolved === null) {
    // Half a template, or a check this repository has no command for. Not
    // measured here — never a silent pass.
    await deps.record(
      'step.not_measured',
      node.id,
      `${node.stepId} names "${command}", which nothing in this repository's toolchain resolves.`
    )
    const name = /toolchain\.(\w+)/.exec(command)?.[1] ?? node.stepId
    return { node, skipped: true, skipReason: `no ${name} command in this repository` }
  }
  const logPath = path.join(
    run.recordsDir(),
    'runs',
    `${safeFilename(node.id)}.${node.attempts}.log`
  )
  const exitCode = await deps.runCommand({ node, command: resolved, title: node.stepId, logPath })
  const roleId = node.role
  return {
    node,
    result: { sessionId: `${node.id}-command`, exitCode },
    roleId,
    readOnly: roleId !== null && !run.roles.mayWrite(roleId),
    outputPath: run.outputFor(node, roleId),
    command: resolved,
    logPath,
  }
}

async function runAgentNode(run: Execution, node: RunNode, step: Step | undefined): Promise<Ran> {
  const roleId = node.role
  const resumeSessionId = resumeFor(run, node)
  const skillsMount = await mountNodeSkills(run, node)
  // The previous process of this conversation may still be sitting at its
  // prompt. Two processes must not share one conversation — the same reason
  // `endAndWait` exists for a resumed terminal session.
  if (resumeSessionId !== undefined) await run.deps.endSession(resumeSessionId)
  const input = agentInput(run, node, { resumeSessionId, skillsMount })
  const result = await run.deps.run(input)
  return {
    node,
    result,
    roleId,
    readOnly: input.readOnly,
    outputPath: input.outputPath,
    command: step?.kind === 'run' ? (step.command ?? null) : null,
    logPath: null,
  }
}

// The session this node may carry on in, or undefined for a fresh one: one per lane
// and role, never across a change of role, a role with `allowResume: false` or a
// `context: fresh` step (SUPERVISION.md, "One conversation per lane").
function resumeFor(run: Execution, node: RunNode): string | undefined {
  const roleId = node.role
  const wantsFresh = wantsFreshContext(run.recipe, node)
  const offered = wantsFresh ? undefined : run.deps.sessionFor(node.lane ?? 1, roleId)
  const resumeSessionId =
    roleId !== null && offered !== undefined && run.roles.mayResume(roleId) ? offered : undefined
  if (roleId !== null) run.roles.assertResumable(roleId, resumeSessionId)
  return resumeSessionId
}

// This node's skills, mounted for its agent outside the checkout, read-only and
// refreshed every run. Only an agent gets a mount; null when it declared none.
async function mountNodeSkills(run: Execution, node: RunNode): Promise<string | null> {
  const skillIds = skillsFor(run.recipe, node, run.roles)
  if (skillIds.length === 0) return null
  const skillsMount = path.join(run.recordsDir(), 'skills-mount', safeFilename(node.id))
  const { skills } = resolveSkills(skillIds, run.deps.sources)
  mountSkills(skillsMount, skills)
  await run.deps.record(
    'skills.mounted',
    node.id,
    skills.map((skill) => `${skill.id} (${skill.rung})`).join(', ')
  )
  return skillsMount
}

type AgentInput = Parameters<ExecutorDeps['run']>[0]

function agentInput(
  run: Execution,
  node: RunNode,
  session: { resumeSessionId: string | undefined; skillsMount: string | null }
): AgentInput {
  const { roles, recipe } = run
  const roleId = node.role
  const outputPath = run.outputFor(node, roleId)
  const outputsDir = run.outputsDirFor(roleId)
  const tier = (roleId === null ? null : roles.get(roleId))?.modelTier ?? 'deep'
  return {
    node,
    role: roleId,
    prompt: promptFor({ order: run.briefed, recipe, roles, rules: run.deps.rules }, node, {
      outputPath,
      outputsDir,
    }),
    resumeSessionId: session.resumeSessionId,
    readOnly: roleId !== null && !roles.mayWrite(roleId),
    modelTier: tier,
    skillsMount: session.skillsMount,
    effort: tier === 'fast' ? null : (stepFor(recipe, node)?.effort ?? recipe.effort ?? null),
    mayUseTool: (tool) => roleId === null || roles.mayUseTool(roleId, tool),
    docsOnly: roleId !== null && roles.writesOnlyDocs(roleId),
    outputPath,
    outputsDir,
    // Reported as it happens rather than waited for: this is what puts a
    // session on a node while there is still an agent in it.
    onStarted: (sessionId) => inBackground(run.noteStarted(node.id, sessionId)),
  }
}
