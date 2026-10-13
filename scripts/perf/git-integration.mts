// Times the git-integration review handlers against a real pull request.
//   npx tsx scripts/perf/git-integration.mts <prNumber> [repoRoot]
// Every child process the handlers spawn is logged, so each step reports its spawn count.
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { promisify } from 'node:util'

const require = createRequire(import.meta.url)
const cp: typeof import('node:child_process') = require('node:child_process')
const log: { cmd: string; ms: number; start: number }[] = []
const T0 = performance.now()
const orig = cp.execFile
type ExecFileAsync = (...a: unknown[]) => Promise<unknown>
const custom: ExecFileAsync = Reflect.get(orig, promisify.custom)
const labelOf = (a: unknown[]) =>
  [String(a[0]).split('/').pop(), ...((a[1] as string[] | undefined) ?? []).slice(0, 4)]
    .join(' ')
    .slice(0, 90)
function wrapped(this: unknown, ...a: unknown[]) {
  const s = performance.now()
  const label = labelOf(a)
  const last = a[a.length - 1]
  const cb = typeof last === 'function' ? (a.pop() as (...r: unknown[]) => void) : null
  return Reflect.apply(orig, this, [
    ...a,
    (...r: unknown[]) => {
      log.push({ cmd: label, ms: performance.now() - s, start: s - T0 })
      cb?.(...r)
    },
  ])
}
const wrappedAsync: ExecFileAsync = (...a) => {
  const s = performance.now()
  const label = labelOf(a)
  return custom(...a).finally(() =>
    log.push({ cmd: label, ms: performance.now() - s, start: s - T0 })
  )
}
Object.assign(wrapped, { [promisify.custom]: wrappedAsync })
Object.assign(cp, { execFile: wrapped })
syncBuiltinESMExports()

// The handlers log one line per call; the steps below summarise them.
console.debug = () => {}

const prNumber = Number(process.argv[2])
if (!Number.isInteger(prNumber) || prNumber <= 0) {
  console.error('usage: npx tsx scripts/perf/git-integration.mts <prNumber> [repoRoot]')
  process.exit(2)
}
const repoRoot = process.argv[3] ?? process.cwd()

const { registerGithubHandlers } = await import(
  '../../extensions/git-integration/src/ipc/github.ipc.ts'
)
interface HandlerResult {
  error?: string
  pr?: { chapters?: { files: { path: string }[] }[]; baseRefName: string; headSHA: string }
}
type Handler = (p: unknown) => Promise<HandlerResult>
const handlers: Record<string, Handler> = {}
registerGithubHandlers(
  (channel: string, fn: Handler) => {
    handlers[channel] = fn
  },
  { getGhPath: () => '', getToken: () => '' },
  undefined,
  () => []
)

async function step(name: string, fn: () => Promise<HandlerResult | void>) {
  const before = log.length
  const s = performance.now()
  const result = await fn()
  const ms = Math.round(performance.now() - s)
  const spawns = log.slice(before)
  console.log(
    `${name.padEnd(34)} ${String(ms).padStart(6)} ms  ${String(spawns.length).padStart(4)} spawns${result?.error ? `  ERROR ${result.error}` : ''}`
  )
  const slowest = [...spawns].sort((x, y) => y.ms - x.ms).slice(0, 3)
  for (const x of slowest) console.log(`    ${String(Math.round(x.ms)).padStart(6)} ms  ${x.cmd}`)
  return result
}

const call = (channel: string, payload: Record<string, unknown>) => () =>
  handlers[channel]({ repoRoot, ...payload })

console.log(`PR #${prNumber} in ${repoRoot}\n`)
await step('list-open-prs', call('github:list-open-prs', {}))
const detail = await step('pr-review-detail', call('github:pr-review-detail', { prNumber }))
await step('pr-inline-comments', call('github:pr-inline-comments', { prNumber }))

const pr = detail?.pr
const files: string[] = (pr?.chapters ?? []).flatMap((c) => c.files.map((f) => f.path))
if (!pr || files.length === 0) {
  console.log('\nNo files in the detail; stopping before the per-file steps.')
  process.exit(1)
}
console.log(`\n${files.length} files\n`)

const known = { baseRef: pr.baseRefName, headSHA: pr.headSHA }
await step('pr-file-diff cold', call('github:pr-file-diff', { prNumber, path: files[0] }))
for (const [i, path] of files.slice(0, 3).entries()) {
  await step(
    `pr-file-diff switch ${i + 1}${i === 0 ? ' (fills cache)' : ' (cached)'}`,
    call('github:pr-file-diff', { prNumber, path, ...known })
  )
}

await step(`files-metrics x${files.length}`, call('github:files-metrics', { paths: files }))
await step(`file-metrics x${files.length} (one by one)`, async () => {
  for (const path of files) await handlers['github:file-metrics']({ repoRoot, path })
})
