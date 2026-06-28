import type { ExtensionAPI } from '../../../../src/main/extensions/api.js'
import type { PhaseId } from '../types/speckit.types.js'

export interface RunnerHandle {
  stop(): void
}

export interface StartPhaseRunnerOpts {
  featureDir: string
  worktreePath: string
  phaseCommand: string
  phase: PhaseId
  feedbackNote?: string
  batchIndex?: number
}

export interface AgentRunner {
  startPhaseRunner(opts: StartPhaseRunnerOpts): RunnerHandle
}

const SELF_REVIEW_CMD = [
  'npm run format',
  'npm run lint',
  'npx vitest run --coverage',
  'claude --headless --print /google-review',
].join(' && ')

export function createAgentRunner(api: ExtensionAPI): AgentRunner {
  return {
    startPhaseRunner(opts) {
      const { featureDir, worktreePath, phaseCommand, phase, feedbackNote, batchIndex } = opts

      const sessionId = `speckit-${phase}-${Date.now()}`

      let cmd: string
      if (phase === 'self-review') {
        cmd = SELF_REVIEW_CMD
      } else {
        cmd = `claude --headless --print "${phaseCommand.replace(/"/g, '\\"')}"`
        if (feedbackNote) {
          cmd += ` "${feedbackNote.replace(/"/g, '\\"')}"`
        }
      }

      const outputBuffer: string[] = []

      const sessionActual = api.pty.spawn(
        sessionId,
        worktreePath,
        cmd,
        'agent',
        (data: string) => {
          outputBuffer.push(data)
          const lines = data.split('\n')
          for (const line of lines) {
            if (line) {
              api.window.broadcast('speckit:run-output', {
                featureDir,
                line,
                ts: new Date().toISOString(),
              })
            }
          }
        },
        (exitCode: number) => {
          if (phase === 'implement' && batchIndex !== undefined) {
            api.window.broadcast('speckit:checkin-ready', {
              featureDir,
              batchIndex,
              diffSummary: outputBuffer.join('').slice(-500),
            })
          } else {
            api.window.broadcast('speckit:run-phase-complete', {
              featureDir,
              phase,
              exitCode,
            })
          }
        }
      )

      return {
        stop() {
          api.pty.kill(sessionActual)
        },
      }
    },
  }
}
