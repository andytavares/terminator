import { randomUUID } from 'crypto'
import type { SupervisionService } from './supervision-service.js'
import { composeAgentPrompt } from './workitems/compose-agent-prompt.js'
import { decideAutonomy } from './autonomy/autonomy-ladder.js'
import { loadRepoConfig } from './worktree/repo-config.js'
import type { AutonomyLevel } from '../../shared/types/supervision.js'
import type { BackpressureDecision } from './review/backpressure.js'

// Starting a supervised session. Everything the console does downstream —
// runtime state, stall detection, review, backpressure — is reachable only
// because this exists; without it the substrate has nothing to supervise.
//
// The order is the specification's: check backpressure, provision, then start.
// Backpressure first because refusing after provisioning would waste the
// worktree, and provisioning before starting because an agent with no working
// copy has nowhere to work.

export interface AssignRequest {
  repoPath: string
  branch: string
  worktreeRoot: string
  autonomyLevel: AutonomyLevel
  /** False when the operator picked an existing branch. */
  isNewBranch?: boolean
  /** Bound lane, when the work came from a work item. */
  workItemId?: string
  laneOrd?: number
  /** Free-text steer, or the whole instruction for ad-hoc work. */
  instruction?: string
  /** Set after the operator accepts a recorded override (FR-054). */
  overrideBackpressure?: boolean
}

export type AssignResult =
  | { ok: true; sessionId: string; worktreePath: string }
  | { ok: false; reason: string; backpressure?: BackpressureDecision }

export function createAssigner(service: SupervisionService, now: () => number = Date.now) {
  return {
    /** What the console would refuse right now, without starting anything. */
    precheck(): BackpressureDecision {
      return service.backpressure.check()
    },

    async assign(request: AssignRequest): Promise<AssignResult> {
      // Implementation cannot begin until the operator has approved both the
      // specification and the plan (FR-083). Deliberate friction: an agent
      // starting without an approved spec has nothing bounding its scope.
      if (request.workItemId !== undefined) {
        const gates = service.mayBeginImplementation(request.workItemId)
        if (!gates.allowed) return { ok: false, reason: gates.reason ?? 'gates not approved' }
      }

      const gate = service.backpressure.check()
      if (!gate.allowed && request.overrideBackpressure !== true) {
        // Refused with the reason and the count, not a greyed-out button.
        return { ok: false, reason: gate.reason ?? 'review queue is full', backpressure: gate }
      }

      const sessionId = randomUUID()
      const workItemId = request.workItemId ?? sessionId

      if (gate.allowed === false && request.overrideBackpressure === true) {
        // Recorded with the queue depth at the moment it was ignored.
        service.backpressure.override(sessionId, now())
      }

      service.registry.register(sessionId, {
        workItemId: request.workItemId ?? null,
        laneOrd: request.laneOrd ?? null,
        repoPath: request.repoPath,
        worktreePath: '',
        branch: request.branch,
        autonomyLevel: request.autonomyLevel,
      })

      const provisioned = await service.provisioner.provision({
        sessionId,
        workItemId,
        repoPath: request.repoPath,
        branch: request.branch,
        worktreeRoot: request.worktreeRoot,
        isNewBranch: request.isNewBranch,
      })

      if (!provisioned.ok) {
        // The state machine has already moved the session to `failed` from the
        // setup_finished event, with the command output attached (FR-034). No
        // agent starts.
        return {
          ok: false,
          reason: `setup exited ${provisioned.setup?.exitCode ?? 1}`,
        }
      }

      service.registry.register(sessionId, {
        workItemId: request.workItemId ?? null,
        laneOrd: request.laneOrd ?? null,
        repoPath: request.repoPath,
        worktreePath: provisioned.worktreePath,
        branch: request.branch,
        autonomyLevel: request.autonomyLevel,
      })

      if (request.workItemId !== undefined && request.laneOrd !== undefined) {
        // Console-owned; the producer's file is never touched (FR-075).
        service.laneBindings.bind(request.workItemId, request.laneOrd, sessionId, now())
      }

      const published = service.publications
        .snapshot()
        .items.find((entry) => entry.item.id === request.workItemId)

      const config = loadRepoConfig(request.repoPath)

      await service.driver.start({
        sessionId,
        // The lane's tasks and the artefact paths, so the work item actually
        // reaches the agent (FR-039).
        prompt: composeAgentPrompt({
          item: published?.item ?? null,
          laneOrd: request.laneOrd ?? null,
          instruction: request.instruction,
        }),
        cwd: provisioned.worktreePath,
        // Chosen at assign time, not renegotiated per prompt (FR-041).
        autoDecide: (toolName, input) =>
          decideAutonomy(request.autonomyLevel, toolName, input, {
            worktreePath: provisioned.worktreePath,
            allowedHosts: config.network.allowedHosts,
          }),
      })

      return { ok: true, sessionId, worktreePath: provisioned.worktreePath }
    },
  }
}
