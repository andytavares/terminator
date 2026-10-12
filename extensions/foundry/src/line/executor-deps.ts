import { createPassCache } from '../verify/pass-cache.js'
import type { ExtensionAPI } from '@terminator/extension-sdk'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { rulesFor } from '../verify/rules.js'
import { createLiveGateStore } from '../gates/store.js'
import { createOrderStore } from '../order/store.js'
import type { ShellExec } from './integrate.js'
import {
  ensureCheckouts,
  ensureBaseCheckout,
  removeBaseCheckout,
  unlinkBorrowedDependencies,
} from './worktree.js'
import type { Checkout } from './worktree.js'
import { installCommandFor } from '../verify/toolchain-probe.js'
import { writeObservedFiles } from './observed-files.js'
import { issueOf, workspaceFor } from './order-project.js'
import { endAndWait } from '../runtime/end-session.js'
import { readChangedFiles, readDiffSummary } from '../runtime/diff-metrics.js'
import type { RunCommand } from '../runtime/diff-metrics.js'
import { isLockfile } from '../runtime/review/risk-grader.js'
import { createRoleRegistry } from './roles.js'
import type { StartedRun, ExecutorDeps } from './executor.js'
import type { RunGraph, RunNode } from './run-graph.js'
import type { EffortLevel, Recipe } from '../recipe/parse.js'
import { commitWorktree, committedSince } from './commit.js'
import { collectableWrites, readRungOutput } from './rung-output.js'
import { agentTitle } from '../runtime/agent-title.js'
import { decideTool } from '../runtime/tool-decision.js'
import type { WorkOrder } from '../order/schema.js'
import { orderDir } from '../data-root.js'

import { resolveSources } from '../workspace-root.js'
import { announceLive, indexFor, orderStoreAt, writeGraph } from '../state/live-index.js'
import { readOnlyTools, autonomyFor, modelForTier } from '../state/settings.js'
import { trustRepository, isProbedCommand } from '../runtime/agent-policy.js'
import { runtime, strandedAgents, isLiveSession } from '../runtime/runtime-state.js'
import { notePending, noteResolved } from '../runtime/held-calls.js'

/**
 * Actually run a graph.
 *
 * The seam `run.start` hands the graph to, and the one place the Line's pieces
 * meet the application: worktrees from `line/worktree.ts`, sessions from the
 * supervised runner, and the wave loop from `line/executor.ts`.
 *
 * Everything the executor enforces is enforced structurally rather than asked
 * for in a prompt — a role that may not resume is never handed a session, and
 * a role with no write list is run read-only, refused by the `PreToolUse` hook
 * rather than by a reminder in its own instructions.
 */
export async function buildExecutorDeps(
  api: ExtensionAPI,
  root: string,
  order: WorkOrder,
  recipe: Recipe,
  graph: RunGraph
): Promise<{
  deps: ExecutorDeps
  exec: ShellExec
  store: ReturnType<typeof createOrderStore>
  houseRules: ReturnType<typeof rulesFor>['rules']
}> {
  const exec: ShellExec = (options) => api.shell.exec(options)
  // `diff-metrics` speaks in bare command and args; the core allowlist admits
  // `git` and `gh` and nothing else, so anything past those is refused here
  // rather than attempted.
  const diffCommand: RunCommand = async (command, args, cwd) => {
    if (command !== 'git' && command !== 'gh') return { ok: false, stdout: '' }
    const result = await exec({ command, args, cwd })
    return { ok: result.exitCode === 0, stdout: result.stdout }
  }
  const startedAt = Date.now()
  // Every checkout before any agent starts: a run that provisions lane 2 half
  // way through and fails has already spent lane 1's agent budget.
  const checkouts = await ensureCheckouts(order, { exec, root })
  // Made the first time a failed rung is run again on the base branch, and
  // taken away by `releaseBase` — most runs never need one.
  let baseCheckout: Checkout | null = null
  const passes = createPassCache(async (args, cwd) => {
    const result = await exec({ command: 'git', args, cwd })
    return { exitCode: result.exitCode, stdout: result.stdout }
  })

  const baseOf = (checkout: Checkout): string => {
    const declared = order.context.repos.find((repo) => repo.name === checkout.repo)?.baseBranch
    return declared === undefined || declared === '' ? 'main' : declared
  }

  /**
   * Written down when a step settles, so reading the refinery's queue never
   * has to ask git what a checkout has changed. Git reporting nothing means
   * it could not be read, so an empty answer keeps what was recorded before.
   */
  const recordObservedFiles = async (): Promise<void> => {
    const files: string[] = []
    for (const checkout of checkouts.values()) {
      files.push(...(await readChangedFiles(checkout.path, baseOf(checkout), diffCommand)))
    }
    if (files.length === 0) return
    await writeObservedFiles(root, order.id, files)
    indexFor(root).announce({ kind: 'graph', orderId: order.id })
  }
  const settledIn = (g: RunGraph): number =>
    g.nodes.filter((n) => n.state !== 'waiting' && n.state !== 'running').length
  let settledSeen = settledIn(graph)

  /** What the working copies have actually changed, against their base. */
  const readObservedChange = async (): Promise<{
    changedFiles: string[]
    linesChanged: number
  }> => {
    const changedFiles: string[] = []
    let linesChanged = 0
    for (const checkout of checkouts.values()) {
      const against = baseOf(checkout)
      changedFiles.push(...(await readChangedFiles(checkout.path, against, diffCommand)))
      // A lockfile's lines would turn every new dependency into a "large change".
      const summary = await readDiffSummary(
        checkout.path,
        against,
        diffCommand,
        (file) => !isLockfile(file)
      )
      linesChanged += summary.added + summary.removed
    }
    return { changedFiles, linesChanged }
  }

  const workspaceOf = (checkout: { origin: string }): string =>
    workspaceFor(api.workspace?.list() ?? [], checkout.origin)
  const store = orderStoreAt(root)
  const featureDir = orderDir(root, order.id)

  // One conversation per role, per lane. A fresh agent per node is a terminal
  // per node and an agent that has read nothing — the failure `continueRun`
  // exists to avoid — but a conversation carried across a change of role
  // carries the last role's identity with it, which broke three live runs.
  // The executor decides; this only remembers what is open.
  //
  // Seeded from the graph rather than started empty. A resumed run's agents
  // are gone but their transcripts are not — `claude --resume` picks the
  // conversation back up — so without this a run picked back up after a
  // restart put a cold agent that had read nothing into a worktree half full
  // of somebody else's work.
  const conversations = new Map<string, string>()
  /**
   * Lane and role together, because the role is the guard.
   *
   * A node can only ever be offered the conversation its own role has been
   * having. A bare command — a recipe's `run` step, a ladder rung — has no
   * role and gets its own, so eight rungs are still one conversation rather
   * than eight fresh agents each re-reading the repository to run one command,
   * and none of them arrives carrying the builder's identity.
   */
  const conversation = (lane: number, role: string | null): string => `${lane}:${role ?? 'command'}`

  for (const node of graph.nodes) {
    if (node.sessionId === null || node.role === null) continue
    conversations.set(conversation(node.lane ?? 1, node.role), node.sessionId)
  }

  /**
   * One node, from launch to the end of its turn.
   *
   * A promise around the runner's callbacks rather than an await, because the
   * runner reports an ending through `onEnd` and returns as soon as the
   * session exists. Settled exactly once: an agent that both fails to start
   * and reports an end would otherwise resolve twice.
   */
  function runNode(input: {
    node: RunNode
    role: string | null
    prompt: string
    resumeSessionId: string | undefined
    readOnly: boolean
    modelTier: 'fast' | 'deep'
    /** The step's effort, resolved by the executor; null passes no flag. */
    effort: EffortLevel | null
    /** Whether this role declared the class of work a tool belongs to. */
    mayUseTool: (tool: string) => boolean
    /** The role writes documentation only; edits elsewhere are refused. */
    docsOnly?: boolean
    /** The one file this rung may write, or null when it has no artefact. */
    outputPath?: string | null
    /** The order's `outputs/` directory, for a role that hands back a document. */
    outputsDir?: string | null
    /** Where this node's skills were mounted, or null when it declared none. */
    skillsMount: string | null
    /** Called as soon as the session exists, not when its turn ends. */
    onStarted?: (sessionId: string) => void
  }): Promise<StartedRun> {
    const checkout = checkouts.get(input.node.lane ?? 1)
    // No checkout and no runner mean nothing ran. Reported with a null exit
    // status, which the verdict path reads as "not measured" — calling it a
    // pass or a failure would both be claims nobody checked.
    const runner = runtime.supervisedRunner
    if (checkout === undefined || runner === null) {
      return Promise.resolve({ sessionId: `${input.node.id}-unstarted`, exitCode: null })
    }

    return new Promise<StartedRun>((resolve) => {
      const lane = input.node.lane ?? 1
      let sessionId = `${input.node.id}-unstarted`
      // Where this node's turn begins in the lane's transcript. Every node
      // after the first resumes that conversation, so without the mark a rung
      // reads an earlier node's tool calls as its own.
      let transcriptFrom = 0
      let settled = false
      const finish = (exitCode: number | null): void => {
        if (settled) return
        settled = true
        resolve({ sessionId, exitCode, transcriptFrom })
      }

      // Claude Code shows its workspace trust dialog for a directory it has
      // not seen, in interactive sessions only — and this is an interactive
      // session by design. Without this the agent comes up, sits at that
      // dialog, and never starts: the process is running, the register has it,
      // the graph says `running`, and nothing happens for ever.
      //
      // Keyed to the repository rather than the worktree, because that is what
      // the documentation says trust is keyed to for a worktree.
      trustRepository(api, checkout.origin, order.id, store)

      void runner
        .start({
          featureDir,
          worktreePath: checkout.path,
          workspaceId: workspaceOf(checkout),
          branch: checkout.branch,
          issue: issueOf(order),
          title: agentTitle(input.role ?? input.node.stepId),
          prompt: input.prompt,
          phase: (input.role ?? input.node.id) as never,
          resumeSessionId: input.resumeSessionId,
          model: modelForTier(api, input.modelTier),
          effort: input.effort ?? undefined,
          addDirs: input.skillsMount === null ? undefined : [input.skillsMount],
          // The read-only decision is taken by the same policy the hook
          // applies, so a verifier that decides to fix what it found is
          // refused rather than reminded.
          // Two gates, not one. Read-only is the whole-role decision; the
          // second holds a role that may write to what it said it writes with
          // — a scribe that decided to edit source rather than documentation
          // is refused by the first if it has no checkout, and by neither if
          // the only check were "may this role write at all".
          // Composed in `runtime/tool-decision.ts`, where it can be tested:
          // every live failure of this feature that was not a stall came from
          // this decision, and the tests that mention `autoDecide` all pass a
          // stub, so they covered the bridge and never the decision.
          autoDecide: (tool, toolInput) =>
            decideTool({
              tool,
              input: toolInput,
              readOnly: input.readOnly,
              role: input.role,
              mayUseTool: input.mayUseTool,
              docsOnly: input.docsOnly,
              isProbed: (name, given) => isProbedCommand(order, name, given),
              readOnlyTools: readOnlyTools(api),
              autonomy: autonomyFor(api),
              letModeDecide:
                api.settings?.get<boolean>('terminator.foundry.letAutoModeDecide') ?? true,
              worktreePath: checkout.path,
              outputPath: input.outputPath ?? null,
              outputsDir: input.outputsDir ?? null,
              skillsMount: input.skillsMount,
            }),
          onPending: (pending) => {
            // Asks reach the console as well as the inbox. A refusal is posted
            // here and a *question* was not, so an agent waiting on one looked
            // exactly like an agent that had gone quiet — which is what it
            // then became. Watched live: a builder redirected its test output
            // to a scratch file outside the checkout, FR-050 asked about it,
            // nobody was there, the bridge handed the call back to the
            // terminal's own prompt five minutes later, and the run sat until
            // the wall-clock budget ended it half an hour on. Nothing anywhere
            // said a question had been asked.
            runtime.supervision?.feed.post({
              at: Date.now(),
              sessionId: pending.sessionId,
              author: 'console',
              summary: `asked about ${pending.toolName}: waiting for a decision`,
            })
            // An agent that is asking again is an agent that got past the
            // prompt somebody answered for it.
            strandedAgents.delete(pending.sessionId)
            announceLive(order.id)
            notePending(api, { ...pending, featureDir }, { id: order.id, root })
          },
          onResolved: (requestId, outcome) => {
            // A hand-back is not an answer. The runtime puts its own prompt in
            // the terminal instead, which an unattended run never reaches — so
            // this is the moment the agent stops, and it should say so.
            if (outcome === 'handback') {
              runtime.supervision?.feed.post({
                at: Date.now(),
                sessionId,
                author: 'console',
                summary:
                  'nobody answered, so the question went to the prompt in the terminal — an agent waits there',
              })
              // Recorded, not only posted. A feed entry scrolls away; this is
              // what lets the order say it is waiting on a person rather than
              // building, which is what it said for the two hours after.
              strandedAgents.set(sessionId, { orderId: order.id, sessionId, at: Date.now() })
              announceLive(order.id)
            }
            noteResolved(requestId)
          },
          // Refusals reach the console. An agent being turned down looks
          // exactly like one that has gone quiet, and reading its transcript
          // was the only way to tell them apart.
          onAutoDenied: (tool, reason) =>
            runtime.supervision?.feed.post({
              at: Date.now(),
              sessionId,
              author: 'console',
              summary: `refused ${tool}: ${reason}`,
            }),
          // Set here as well as after `start` resolves, so a turn that ends
          // before the promise settles still names the right session rather
          // than the placeholder.
          onRegistered: (run) => {
            sessionId = run.sessionId
            transcriptFrom = run.transcriptFrom
            // The graph learns the session while there is still an agent in
            // it. Before this the Floor's Watch and Attach appeared only after
            // the turn ended, so the one moment you needed a terminal was the
            // one moment there was no way into it.
            input.onStarted?.(run.sessionId)
          },
          onEnd: (exitCode) => {
            // Off the live list and into the record, so a finished unit stops
            // holding a review slot and the next wave can start.
            runtime.supervision?.finish(sessionId, Date.now())
            runtime.supervision?.runs.archive(
              sessionId,
              exitCode === 0 ? 'ended' : 'stopped',
              Date.now()
            )
            finish(exitCode)
          },
          onTurnEnd: (turns) => {
            void runtime.supervision?.finishTurn(sessionId, turns, Date.now())
            // The node is over when the *turn* is over, not when the process
            // is. A supervised session sits at its prompt after answering —
            // that is the whole point of running it in a terminal you can
            // type into — so waiting for `onEnd` waits for something that
            // never happens, and the Line could not complete a single agent
            // node. Intake has always got this right; this is the same rule.
            //
            // Zero because the turn ended, not because the work was good:
            // whether it was is the verifier's to say and the ladder's to
            // measure, never the producing agent's (FR-033).
            finish(0)
            // Nothing types into it again: a later node in the lane resumes
            // the conversation in a fresh tab. Left at its prompt, every
            // finished node kept a terminal and a process open.
            runtime.supervisedRunner?.stop(sessionId)
          },
        })
        .then((run) => {
          if (run === null) {
            finish(null)
            return
          }
          sessionId = run.sessionId
          transcriptFrom = run.transcriptFrom
          input.onStarted?.(run.sessionId)
          // The lane's open conversation, for the next node that may carry it
          // on. A role that may not resume is never offered it — the registry
          // refuses, structurally — and neither is a role that is not the one
          // whose conversation this is.
          conversations.set(conversation(lane, input.role), run.sessionId)
          // On the register, which is what the stall detector and the palette
          // read from. Without this the agent is running and both see an idle factory —
          // the register was the seam the old phase dispatcher filled.
          runtime.supervision?.runs.add({
            sessionId: run.sessionId,
            featureDir,
            phase: input.role ?? input.node.stepId,
            worktreePath: checkout.path,
            branch: checkout.branch,
            baseBranch:
              checkout.origin === '' ? null : (order.context.repos[0]?.baseBranch ?? null),
            terminalSessionId: run.terminalSessionId,
            transcriptPath: run.transcriptPath,
            startedAt: Date.now(),
          })
          void runtime.supervision?.measure(run.sessionId)
        })
        .catch(() => finish(null))
    })
  }

  const sources = resolveSources(api, root)
  // Read once, so what a rung is told it may hand back and what is accepted
  // from it come from the same resolution of the same role file.
  const roleRegistry = createRoleRegistry(sources)
  const houseRules = rulesFor(sources, {
    repoPaths: sources.repoPaths,
    houseDocs: [...order.context.houseDocs],
  }).rules
  const gates = createLiveGateStore(() => root, indexFor)
  return {
    deps: {
      now: () => new Date().toISOString(),
      sources,
      run: runNode,
      sessionFor: (lane, role) => conversations.get(conversation(lane, role)),
      record: async (action, subject, reason) => {
        await store.record({
          at: new Date().toISOString(),
          orderId: order.id,
          actor: 'rule:line',
          action,
          subject,
          reason,
          evidence: [],
        })
      },
      autonomy: autonomyFor(api),
      // Loaded once, so what an agent is told the house rules are and what the
      // change is judged against are the same list.
      rules: houseRules,
      /**
       * Take what a read-only rung wrote, put it on the order, and save it.
       *
       * The Forge has always had this and the Line never did: four of the
       * standard shape's nine steps are roles whose whole product is a document,
       * and every one of them ended its turn with the document in a terminal
       * nobody reads. Watched on a live run — a scout's complete report of where
       * the application picks its colours, gone; an architect's three defects in
       * the order it was about to be built from, gone, refused on the way out by
       * the very policy that makes the rung trustworthy.
       */
      collect: async ({ nodeId, role, outputPath }) => {
        const current = (await store.load(order.id)) ?? order
        const result = readRungOutput({
          order: current,
          role,
          writes: collectableWrites(roleRegistry.get(role)),
          outputPath,
          at: new Date().toISOString(),
        })
        if (result === null) return null

        // A refusal is a result too, and it is the agent's to act on rather than
        // the operator's to decipher — so it is recorded and the rung is not
        // credited with having filed anything.
        if (!result.ok) {
          await store.record({
            at: new Date().toISOString(),
            orderId: order.id,
            actor: `role:${role}`,
            action: 'rung.refused',
            subject: nodeId,
            reason: result.reason,
            evidence: [],
          })
          return null
        }

        await store.save(result.order)
        return {
          order: result.order,
          note: result.note,
          defect: result.defect,
          document: result.document,
        }
      },
      // An agent that only edited leaves nothing to push, and a pull request
      // opened on it fails with "No commits between". One that committed its
      // own work leaves a clean tree, which is a change all the same.
      commitNode: async ({ node, message }) => {
        const checkout = checkouts.get(node.lane ?? 1)
        if (checkout === undefined) return { kind: 'clean' }
        const outcome = await commitWorktree(checkout.path, message, exec)
        if (outcome.kind !== 'clean') return outcome
        return node.startedAt !== null &&
          (await committedSince(checkout.path, node.startedAt, exec))
          ? { kind: 'committed' }
          : outcome
      },
      priorGates: await gates.list(),
      raise: async (gate) => {
        await gates.save(gate)
        await store.record({
          at: new Date().toISOString(),
          orderId: order.id,
          actor: `rule:${gate.rule}`,
          action: 'gate.raised',
          subject: gate.id,
          reason: gate.why,
          evidence: [...gate.evidence],
        })
      },
      // A rung is a command, not a conversation: its inputs fully determine what
      // it does and its verdict is its exit status. So it runs in a terminal tab
      // of its own in the lane's checkout — visible, like everything else here —
      // with no agent in between to spend a turn on it or a transcript to read
      // the answer back out of.
      runStep: async (step, logPath) => {
        if (step.command === null) return null
        const lane = [...checkouts.keys()].sort((a, b) => a - b)[0] ?? 1
        const checkout = checkouts.get(lane)
        const runner = runtime.supervisedRunner
        // Nothing ran, so nothing was measured — never a pass.
        if (checkout === undefined || runner === null) return null
        if (await passes.passed(checkout.path, step.command)) {
          await fs.promises.mkdir(path.dirname(logPath), { recursive: true })
          await fs.promises.writeFile(
            logPath,
            `${step.command} already passed on this exact commit earlier in this run; not run again.\n`
          )
          return 0
        }
        const exitCode = await runner.runCommand({
          worktreePath: checkout.path,
          workspaceId: workspaceOf(checkout),
          branch: checkout.branch,
          issue: issueOf(order),
          title: step.name,
          command: step.command,
          logPath,
        })
        await passes.record(checkout.path, step.command, exitCode)
        return exitCode
      },
      // The same rung on the base branch, to tell a failure the change caused
      // from one that was already there. Never reads or writes the pass cache:
      // a pass on the base says nothing about the change, and the reverse.
      runStepOnBase: async (step, logPath) => {
        if (step.command === null) return null
        const runner = runtime.supervisedRunner
        if (runner === null) return null
        const lane = [...checkouts.keys()].sort((a, b) => a - b)[0] ?? 1
        try {
          baseCheckout ??= await ensureBaseCheckout(order, lane, { exec, root })
        } catch {
          return null
        }
        const baseBranch = order.context.repos.find((r) => r.lane === lane)?.baseBranch ?? 'base'
        return runner.runCommand({
          worktreePath: baseCheckout.path,
          workspaceId: workspaceOf(baseCheckout),
          branch: baseCheckout.branch,
          issue: issueOf(order),
          title: `${step.name} on ${baseBranch}`,
          command: step.command,
          logPath,
        })
      },
      // A broken install, mended in place. The borrowed links go first, so the
      // install lands in this checkout and never writes into the origin's.
      reinstall: async (where, logPath) => {
        const runner = runtime.supervisedRunner
        if (runner === null) return null
        const lane = [...checkouts.keys()].sort((a, b) => a - b)[0] ?? 1
        const checkout = where === 'base' ? baseCheckout : (checkouts.get(lane) ?? null)
        if (checkout === null) return null
        const command = installCommandFor(checkout.path)
        if (command === null) return null
        await unlinkBorrowedDependencies(checkout, { exec, root })
        return runner.runCommand({
          worktreePath: checkout.path,
          workspaceId: workspaceOf(checkout),
          branch: checkout.branch,
          issue: issueOf(order),
          title: 'Reinstall dependencies',
          command,
          logPath,
        })
      },
      releaseBase: async () => {
        if (baseCheckout === null) return
        const checkout = baseCheckout
        baseCheckout = null
        await removeBaseCheckout(checkout, { exec, root })
      },
      // A recipe `run` step whose command is not a slash instruction runs as a
      // command in the lane's checkout, the same way `runStep` runs a gate's
      // check — visible, and never handed to an agent that would report a
      // pass regardless of what the command did.
      runCommand: async (input) => {
        const lane = input.node.lane ?? [...checkouts.keys()].sort((a, b) => a - b)[0] ?? 1
        const checkout = checkouts.get(lane)
        const runner = runtime.supervisedRunner
        // Nothing ran, so nothing was measured — never a pass.
        if (checkout === undefined || runner === null) return null
        const exitCode = await runner.runCommand({
          worktreePath: checkout.path,
          workspaceId: workspaceOf(checkout),
          branch: checkout.branch,
          issue: issueOf(order),
          title: agentTitle(input.title),
          command: input.command,
          logPath: input.logPath,
        })
        await passes.record(checkout.path, input.command, exitCode)
        return exitCode
      },
      // The previous process of this conversation may still be sitting at its
      // prompt when a node resumes it. Two processes must not share one
      // conversation — the same reason `endAndWait` exists for a follow-up turn.
      endSession: (sessionId) =>
        endAndWait(
          {
            stop: (id, reason) => runtime.supervisedRunner?.stop(id, reason) ?? false,
            isLive: isLiveSession,
          },
          sessionId,
          'continuing the lane in its next step'
        ).then(() => undefined),
      observe: async () => ({
        // Fractional on purpose. Rounded, a run at 19:31 reported "20" and a
        // twenty-minute budget could only be exceeded at 20:30 — so a run whose
        // deadline was the budget never saw the gate at all. The gate rounds it
        // for the sentence it prints; the comparison is exact.
        elapsedMinutes: (Date.now() - startedAt) / 60_000,
      }),
      onEvent: (event) => {
        if (event.type !== 'verdict') return
        void store.record({
          at: new Date().toISOString(),
          orderId: order.id,
          actor: `role:${event.verdict.producedBy.role}`,
          action: 'verify.verdict',
          subject: event.verdict.criterionId,
          reason: `${event.verdict.result}${event.verdict.reason === '' ? '' : `: ${event.verdict.reason}`}`,
          evidence: [...event.verdict.evidence],
        })
      },
      // Written on every change rather than only at the end. `run.observe` reads
      // this file, so without it the Floor shows the graph the run started with
      // for the whole of the run.
      persist: async (next) => {
        await writeGraph(root, next)
        if (settledIn(next) === settledSeen) return
        settledSeen = settledIn(next)
        // A record the queue reads is not worth failing the run over.
        await recordObservedFiles().catch(() => undefined)
      },
      // What the work actually changed, so the regrade answers for the change
      // rather than for the plan that predicted it. Without this the executor
      // was handed the units' own `touches` list and a hardcoded zero lines, so
      // a builder that went outside what it declared was invisible to the check
      // that exists to notice, and nothing could ever grade worse than planned.
      observedChange: readObservedChange,
      // Lets the budget be re-read while agents are in flight. Without it the
      // wall-clock budget can only fire between waves, which is every case
      // except the one it exists for: an agent that never comes back.
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    },
    exec,
    store,
    houseRules,
  }
}
