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
function trackedStart(input: StartInput): Promise<unknown> {
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
  return Promise.race([theRunner.start(tracked), gone])
}

/** Ends every turn still open, with no exit code, as disposing the real runner does. */
export function endOpenTurns(): void {
  for (const turn of [...openTurns]) turn.end()
}

export const createSupervisedRunner = () => ({
  ...theRunner,
  start: (input: StartInput) => trackedStart(input),
  dispose: () => {
    endOpenTurns()
    theRunner.dispose()
  },
})
