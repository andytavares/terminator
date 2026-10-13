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

/**
 * A `run` step whose command is not a slash instruction runs as a command,
 * not as an agent. Handed to an agent, a `run` step was told "run this
 * exactly" and the turn's end reported exit 0 regardless — a `run` step could
 * never actually fail. A slash command such as `/speckit-plan` is an agent
 * instruction, not a shell command, and keeps going to `deps.run`.
 */
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
  const logPath = path.join(run.dir(), 'runs', `${safeFilename(node.id)}.${node.attempts}.log`)
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

/**
 * The session this node may carry on in, or undefined for a fresh one.
 *
 * One conversation per lane, where the role allows it. A fresh agent per node
 * is a terminal per node and an agent that has read nothing — which is what
 * `continueRun` exists to avoid. `assertResumable` is what makes the
 * permission structural: a role with `allowResume: false` is *handed*
 * undefined, so the refusal cannot be forgotten by a caller.
 *
 * A step may demand a fresh conversation even from a role that is allowed to
 * resume. Five of the six built-in shapes say `context: fresh` on their verify
 * step, and it reached nothing — the effect happened to hold only because the
 * verifier's own role file forbids resuming, so a recipe asking it of any
 * other role got a resumed session anyway.
 *
 * And never across a change of role. The conversation carries who the agent
 * has been, not only what it has read, and forty turns of being the architect
 * outweigh a paragraph saying the next turn is the builder's. Three live runs
 * died on it. The last one ended with the builder writing its own recap: "I've
 * handed over the work order with criteria and two units, and I'm waiting on
 * your sign-off plus write access to implement." It was still the architect,
 * waiting to be approved, while the graph said the unit was being built.
 *
 * This is what `context: fresh` already says for the verifier, and the
 * evidence is that it is not a verifier quirk — it is what a change of role
 * needs. What the architect produced is carried by the work order, which is
 * the artefact for exactly that, rather than by a context window that also
 * carries its posture.
 *
 * A role continuing its own work still resumes, which is where the saving
 * was: a builder taking a second unit in the same lane keeps everything it
 * learned taking the first. `sessionFor` keys on the role, so across a
 * boundary there is simply nothing to offer.
 */
function resumeFor(run: Execution, node: RunNode): string | undefined {
  const roleId = node.role
  const wantsFresh = wantsFreshContext(run.recipe, node)
  const offered = wantsFresh ? undefined : run.deps.sessionFor(node.lane ?? 1, roleId)
  const resumeSessionId =
    roleId !== null && offered !== undefined && run.roles.mayResume(roleId) ? offered : undefined
  if (roleId !== null) run.roles.assertResumable(roleId, resumeSessionId)
  return resumeSessionId
}

/**
 * This node's skills, mounted for its agent — outside the checkout,
 * read-only, and refreshed on every run rather than only the first. A run
 * step that ran as a command never reaches here, so only an agent ever gets a
 * mount. Null when it declared none.
 */
async function mountNodeSkills(run: Execution, node: RunNode): Promise<string | null> {
  const skillIds = skillsFor(run.recipe, node, run.roles)
  if (skillIds.length === 0) return null
  const skillsMount = path.join(run.dir(), 'skills-mount', safeFilename(node.id))
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
    onStarted: (sessionId) => void run.noteStarted(node.id, sessionId),
  }
}
