/** The supervised runner's module as a spec mocks it:
 * `vi.mock('…/supervised-runner.js', () => import('../helpers/supervision-mocks.js'))`.
 * Vitest loads modules once per spec file, so each file gets a runner of its own. */
import { fakeRunner } from './foundry-host.js'

export const theRunner = fakeRunner()

/** A started turn, with the way to end it as the real runner's dispose does. */
interface OpenTurn {
  end: () => void
}

const openTurns = new Set<OpenTurn>()

type StartInput = { onEnd?: (exitCode: number | null) => void } & Record<string, unknown>

/** The turn as the spec scripts it, tracked until it ends; ending it settles a start the spec
 * never let finish, with no session, as a runner that is gone would. */
function trackedStart(input: StartInput): PromiseLike<unknown> {
  let ended = (): void => undefined
  const gone = new Promise<null>((resolve) => (ended = () => resolve(null)))
  const turn: OpenTurn = {
    end: () => {
      openTurns.delete(turn)
      ended()
      input.onEnd?.(null)
    },
  }
  const tracked = {
    ...input,
    onEnd: (exitCode: number | null) => {
      openTurns.delete(turn)
      input.onEnd?.(exitCode)
    },
  }
  openTurns.add(turn)
  const { whenStarted, markStarted } = startSignal()
  return thenMarkStarted(
    Promise.race([theRunner.start({ ...tracked, whenStarted }), gone]),
    markStarted
  )
}

/** `whenStarted(end)` runs `end` once the turn is marked started, or at once if it is. */
function startSignal() {
  let started = false
  const waiting: (() => void)[] = []
  const whenStarted = (end: () => void) => (started ? end() : void waiting.push(end))
  const markStarted = () => {
    started = true
    waiting.splice(0).forEach((end) => end())
  }
  return { whenStarted, markStarted }
}

/** `start`'s answer, which marks the turn started once its caller's `then` has run. A fake ends
 * its turn with `input.whenStarted`, so the turn ends after the app took in the session, as a
 * real agent's turn does. Foundry reads `start` with `.then`, never `await`. */
function thenMarkStarted(answer: Promise<unknown>, markStarted: () => void): PromiseLike<unknown> {
  return {
    then: (onSession, onFailure) =>
      answer.then((run) => {
        // No handler passes the session on, as a promise's `then` does.
        const result = onSession ? onSession(run) : (run as never)
        markStarted()
        return result
      }, onFailure),
  }
}

/** Ends every turn still open, with no exit code, as disposing the real runner does; how many. */
export function endOpenTurns(): number {
  const open = [...openTurns]
  for (const turn of open) turn.end()
  return open.length
}

export const createSupervisedRunner = () => ({
  ...theRunner,
  start: (input: StartInput) => trackedStart(input),
  dispose: () => {
    endOpenTurns()
    theRunner.dispose()
  },
})
