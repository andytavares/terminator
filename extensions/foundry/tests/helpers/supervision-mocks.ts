/** The supervised runner's and the control server's modules as a spec mocks both:
 * `vi.mock('…/supervised-runner.js', () => import('../helpers/supervision-mocks.js'))`.
 * Vitest loads modules once per spec file, so each file gets a runner of its own. */
import { fakeRunner, quietControlServer } from './foundry-host.js'

export const theRunner = fakeRunner()

export const createSupervisedRunner = () => theRunner

export const createControlServer = async () => quietControlServer()
