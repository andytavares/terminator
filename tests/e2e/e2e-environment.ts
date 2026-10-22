import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { testEnvironment } from '../../scripts/test-env.mjs'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

/** Stand-ins for `claude`, `gh` and `ngrok`, first on the app's PATH so no run starts a real one. */
export const STUB_BIN_DIR = join(FIXTURES, 'bin')

/**
 * A minimal zsh config the app's terminals read instead of the developer's. Terminals are login
 * shells (src/main/terminal/pty-manager.ts) whose own rc files would put a real `claude` ahead of
 * the stub; this one is read last and puts the stub first again.
 */
const STUB_ZDOTDIR = join(FIXTURES, 'zdotdir')

export interface AppDirectories {
  /** The app's home: where its `~/.claude/settings.json` writes land. */
  home: string
  tmpdir: string
}

/**
 * The environment an e2e app launches in, sealed (ADR 123): fixed values and a short allowlist
 * from `inherited`, never the developer's whole environment and never their real HOME.
 */
export function sealedAppEnvironment(
  directories: AppDirectories,
  inherited: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  return {
    ...testEnvironment({ ...directories, stubs: [STUB_BIN_DIR] }, inherited),
    // Pins terminal.defaultShell's SHELL fallback to zsh so ZDOTDIR applies on a bash runner too.
    ZDOTDIR: STUB_ZDOTDIR,
    // Hidden windows that keep drawing, no Dock icon (src/main/background-mode.ts).
    TERMINATOR_RUN_IN_BACKGROUND: '1',
    // The main process announces readiness (src/main/e2e-readiness.ts).
    TERMINATOR_E2E: '1',
  }
}
