const MAX_SEED = 2 ** 31 - 1

/** The seed of this run's test order: TEST_SEED when it names one (to rerun a failing order),
 * else a fresh random integer, so no two runs share an order (ADR 123). */
export function testSeed(env: NodeJS.ProcessEnv = process.env): number {
  const given = Number(env.TEST_SEED)
  if (env.TEST_SEED !== undefined && env.TEST_SEED !== '' && Number.isInteger(given)) return given
  return Math.floor(Math.random() * MAX_SEED)
}
