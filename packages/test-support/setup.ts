// Global test setup — runs before every test file regardless of environment.
// CSS modules are not processed in tests; mock them to return an empty object.
import './src/seal-worker-environment'
import { afterAll, afterEach, beforeEach, inject, vi } from 'vitest'
import { configure } from '@testing-library/dom'
import { WAIT_BOUND_MS } from './src/bounds'
import { installNativeDialog } from './src/native-dialog'
import { removeTempDirs } from './src/temp-dir'
import { forgetGitHookEnvironment } from './src/git-hook-env'
import { installNetworkGuard } from './src/network-guard'
import { installUnitIoGuard } from './src/unit-io-guard'
import { createLeakGuard } from './src/leak-guard'

forgetGitHookEnvironment()

// Registered before the spec's own hooks so it runs after them (afterAll runs in reverse,
// https://vitest.dev/config/sequence#sequence-hooks): they close what is inside first.
afterAll(removeTempDirs)

// The tier the project declares (vitest.config.ts): a unit test opens no socket and does no I/O;
// an integration test may reach this machine only.
const tier = inject('testTier')
installNetworkGuard(tier)
if (tier === 'unit') installUnitIoGuard()

if (typeof window === 'undefined') {
  // Registered before every other afterEach, so it runs after all of them (hooks run in reverse).
  const leakGuard = createLeakGuard()
  beforeEach(leakGuard.begin)
  afterEach(leakGuard.check)
}

// A fake clock a test left running does not reach the next test.
afterEach(() => {
  vi.useRealTimers()
})

// findBy* and waitFor wait on a condition; one second failed lazy views on a cold CI runner.
// The bound only catches a hang.
configure({ asyncUtilTimeout: WAIT_BOUND_MS })

vi.mock('*.css', () => ({}))
vi.mock('*.module.css', () => ({ default: {} }))
// Components count their uses over IPC, which most specs do not install. A spec that checks a
// count mocks this module itself, or unmocks it to check the IPC payload.
vi.mock('../core-renderer/src/usage/record', () => ({
  recordUse: vi.fn(),
  declareFeatures: vi.fn(),
}))

// JSDOM does not fully implement the Selection API; patch it to prevent React DOM
// from crashing with "Right-hand side of 'instanceof' is not an object" when
// rendering components with form elements (inputs, checkboxes).
if (typeof window !== 'undefined' && !window.getSelection) {
  window.getSelection = (): Selection | null => null
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

if (typeof window !== 'undefined') installNativeDialog(window)

// jsdom parses its user-agent stylesheet (300+ ms) on a file's first getComputedStyle, which
// every ByRole query calls; paid here, not by whichever test queries first.
if (typeof window !== 'undefined') window.getComputedStyle(document.documentElement)
