/** The environment variable a live spec runs against. A live spec fails when it is missing,
 * rather than skipping and passing on a check nobody ran (T-SAME-ENV). */
export function requiredLiveEnv(name: string, what: string): string {
  const value = process.env[name] ?? ''
  if (value === '') throw new Error(`${name} is not set: ${what}. Run: ${name}=… npm run test:live`)
  return value
}
