// Names vitest itself reads from process.env while it runs a file (VITEST_POOL_ID, TEST, ...).
const VITEST_OWN = /^(VITEST|TEST$)/

/** Makes `env` hold exactly `sealed` (plus vitest's own variables): a variable the developer's
 * shell exported is deleted, because vitest's `test.env` only adds to the environment (ADR 123). */
export function sealEnvironment(sealed: Record<string, string>, env: NodeJS.ProcessEnv): void {
  for (const name of Object.keys(env)) {
    if (!(name in sealed) && !VITEST_OWN.test(name)) delete env[name]
  }
  Object.assign(env, sealed)
}
