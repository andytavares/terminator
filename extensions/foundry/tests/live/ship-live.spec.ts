import { describe, it, expect, beforeAll } from 'vitest'
import { execFile, execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { shipOrder, markReady } from '../../src/line/integrate.js'
import { checkoutPath } from '../../src/line/worktree.js'
import type { ExecResult, ShellExec } from '../../src/line/integrate.js'
import { createOrderStore } from '../../src/order/store.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { Gate } from '../../src/gates/rules.js'

// The one thing the whole suite could never prove: that `git push` and
// `gh pr create --draft` do what this code believes they do.
//
// Every other test mocks `exec` and asserts the argv. That checks the command
// this code *builds*; it cannot check that GitHub accepts it. This runs the
// real binaries against a real remote and reads the pull request back.
//
// Excluded from the default run — it needs `gh` authenticated and a repository
// on GitHub. `FOUNDRY_LIVE_REPO` points at a checkout with a remote.

const LIVE = process.env.FOUNDRY_LIVE_REPO ?? ''

/**
 * The same shape the core shell executor hands the extension: an exit code and
 * the two streams, never a throw.
 */
const exec: ShellExec = ({ command, args, cwd }) =>
  new Promise<ExecResult>((resolve) => {
    execFile(command, args, { cwd, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
      resolve({ exitCode: code, stdout, stderr, timedOut: false })
    })
  })

function git(...args: string[]): void {
  gitIn(LIVE, ...args)
}

function gitIn(cwd: string, ...args: string[]): void {
  const env = { ...process.env }
  delete env.GIT_DIR
  delete env.GIT_INDEX_FILE
  delete env.GIT_WORK_TREE
  execFileSync('git', args, { cwd, env, stdio: 'pipe' })
}

let dataRoot: string
let branch: string

function order(): WorkOrder {
  const base = draftOrder({
    id: 'WO-LIVE-1',
    title: 'Read the session TTL from configuration',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: [LIVE],
    now: new Date().toISOString(),
  })
  return {
    ...base,
    status: 'running',
    recipe: 'direct',
    intent: {
      problem: 'The session TTL is hardcoded, so it cannot differ per environment.',
      outcome: 'The TTL is read from an environment variable, with the current value as default.',
      nonGoals: ['Changing how expiry is computed'],
    },
    acceptance: [
      {
        id: 'AC-1',
        statement: 'A token past its TTL is reported expired.',
        priority: 'P1',
        verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
        unverifiable: null,
      },
    ],
    // P2: below the gated grades, so the draft opens before the decision — the
    // path that actually reaches GitHub.
    risk: { grade: 'P2', triggers: [], blastRadius: ['src/session.js'], criticalPaths: [] },
    plan: {
      ...base.plan,
      units: [
        {
          id: 'U-1',
          title: 'read TTL_MS from the environment',
          role: 'builder',
          lane: 1,
          dependsOn: [],
          satisfies: ['AC-1'],
          touches: ['src/session.js'],
          verify: [],
        },
      ],
      lanes: base.plan.lanes.map((lane) => ({ ...lane, branch })),
    },
  }
}

describe.skipIf(LIVE === '')('shipping, for real', () => {
  beforeAll(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-live-'))
    branch = `foundry/live-${Date.now().toString(36)}`

    // A real change on a real branch **in a real worktree**, because that is
    // where a builder leaves it — and where shipping has to look for it. This
    // used to commit in the repository itself, which is the shape the bug had:
    // `shipOrder` pushed `HEAD:<branch>` from `context.repos[].path`, where
    // `main` is checked out, so the branch reached the remote at the commit it
    // was cut from and GitHub said "No commits between main and <branch>". The
    // test passed throughout, because it had put the work where the bug looked.
    git('fetch', 'origin')
    const worktree = checkoutPath(dataRoot, order(), order().context.repos[0].name)
    fs.mkdirSync(path.dirname(worktree), { recursive: true })
    git('worktree', 'add', '-b', branch, worktree, 'origin/main')
    const file = path.join(worktree, 'src', 'session.js')
    fs.writeFileSync(
      file,
      [
        '/** Milliseconds a session token is good for. */',
        `export const TTL_MS = Number(process.env.SESSION_TTL_MS ?? 15 * 60 * 1000) // ${branch}`,
        '',
        'export function isExpired(issuedAt, now) {',
        '  return now - issuedAt >= TTL_MS',
        '}',
        '',
      ].join('\n')
    )
    gitIn(worktree, 'add', '-A')
    gitIn(worktree, 'commit', '-m', 'read the session TTL from the environment')
  })

  it('pushes the branch and opens a draft pull request GitHub can show back', async () => {
    const raised: Gate[] = []
    const recorded: string[] = []

    const result = await shipOrder(
      order(),
      {
        verdicts: [
          {
            criterionId: 'AC-1',
            nodeId: 'n-verify',
            result: 'pass',
            reason: '',
            command: 'npm test',
            exitCode: 0,
            producedBy: { role: 'verifier', sessionId: 'sess-verifier' },
            at: new Date().toISOString(),
          },
        ],
        findings: [],
        ladder: {
          steps: [
            { rung: 'L0', name: 'Lint', result: 'pass', reason: '', exitCode: 0 },
            { rung: 'L1', name: "The unit's own tests", result: 'pass', reason: '', exitCode: 0 },
            {
              rung: 'L3',
              name: 'Independent verification',
              result: 'elsewhere',
              reason: 'by the verifier on each unit — see the criteria table',
              exitCode: null,
            },
          ],
          stoppedAt: null,
          unmeasured: [],
          ok: true,
        },
        rulesInForce: ['exit-code-not-count (L2)'],
      },
      {
        exec,
        root: dataRoot,
        now: () => new Date().toISOString(),
        autoOpen: true,
        decide: async (gate) => {
          raised.push(gate)
          return 'hold'
        },
        // The real writer, not a spy. `integrateDepsFor` filed every shipping
        // entry under `orderId: subject`, and `ship.draft_opened`'s subject is
        // the pull request URL — so the entry that says the Line did its job
        // went to `orders/https:/github.com/owner/repo/pull/8/ledger.jsonl`
        // and the order's own ledger never mentioned the draft. A spy for
        // `record` cannot see that: it is handed the arguments, not the file.
        record: async (action, subject, reason) => {
          recorded.push(`${action} ${subject} ${reason}`)
          await createOrderStore(dataRoot).record({
            at: new Date().toISOString(),
            orderId: order().id,
            actor: 'rule:ship',
            action,
            subject,
            reason,
            evidence: [],
          })
        },
        raiseGate: async (gate) => {
          raised.push(gate)
        },
      }
    )

    expect(result.pulls, `shipOrder reported: ${JSON.stringify(result)}`).toHaveLength(1)
    const pull = result.pulls[0]
    expect(pull.url).toMatch(/^https:\/\/github\.com\/andytavares\/foundry-live-check\/pull\/\d+$/)

    // Read it back from GitHub rather than trusting what the command printed.
    const view = await exec({
      command: 'gh',
      args: ['pr', 'view', pull.url, '--json', 'isDraft,title,body,headRefName,state'],
      cwd: LIVE,
    })
    expect(view.exitCode, view.stderr).toBe(0)
    const pr = JSON.parse(view.stdout) as {
      isDraft: boolean
      title: string
      body: string
      headRefName: string
      state: string
    }

    // A draft, never a review request (FR-053).
    expect(pr.isDraft).toBe(true)
    expect(pr.state).toBe('OPEN')
    expect(pr.headRefName).toBe(branch)
    // The body GitHub stored is the one written to the order directory.
    expect(pr.body).toContain('AC-1')
    expect(pr.body).toContain('Read the session TTL from configuration')
    expect(fs.readFileSync(pull.bodyPath, 'utf8')).toBe(pr.body)

    // And the decision the operator is finally offered is "mark it ready?",
    // raised only once the draft exists.
    expect(raised.map((g) => g.rule)).toContain('ready-for-review')

    // Left for the reader of the test output.
    // eslint-disable-next-line no-console
    console.log(`live pull request: ${pull.url}`)
  }, 180_000)

  it('turns the draft into a review request when the operator says so', async () => {
    // The last `gh` path with no live cover. `markReady` is what the
    // "mark it ready?" decision runs, and it is the only thing in the whole
    // feature that stops being a draft.
    const opened = await exec({
      command: 'gh',
      args: ['pr', 'list', '--head', branch, '--json', 'url,number', '--limit', '1'],
      cwd: LIVE,
    })
    const [pull] = JSON.parse(opened.stdout) as { url: string; number: number }[]
    expect(pull, 'the previous case did not leave a pull request to mark').toBeDefined()

    await markReady(
      { url: pull.url, cwd: LIVE },
      {
        exec,
        root: dataRoot,
        now: () => new Date().toISOString(),
        autoOpen: true,
        decide: async () => 'approve',
        record: async () => undefined,
      }
    )

    const after = await exec({
      command: 'gh',
      args: ['pr', 'view', pull.url, '--json', 'isDraft,state'],
      cwd: LIVE,
    })
    expect(after.exitCode, after.stderr).toBe(0)
    const state = JSON.parse(after.stdout) as { isDraft: boolean; state: string }
    expect(state.isDraft, 'gh pr ready did not take it out of draft').toBe(false)
    expect(state.state).toBe('OPEN')

    // Put it back, so the repository does not accumulate review requests.
    await exec({ command: 'gh', args: ['pr', 'ready', pull.url, '--undo'], cwd: LIVE })
  }, 120_000)

  it("records the draft in the order's own ledger, and nowhere else", async () => {
    // The entry that says the Line did the thing it exists to do. Its subject
    // is the pull request URL, and filing by subject built a directory tree
    // out of one:
    //
    //   orders/https:/github.com/owner/repo/pull/8/ledger.jsonl
    //
    // while the order's ledger said nothing about the draft it had opened.
    const ledger = path.join(dataRoot, 'orders', order().id, 'ledger.jsonl')
    expect(fs.existsSync(ledger), 'the order has no ledger').toBe(true)
    const actions = fs
      .readFileSync(ledger, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as { action: string })
      .map((entry) => entry.action)
    expect(actions).toContain('ship.draft_opened')

    // And no order directory named after anything but an order.
    const orders = fs.readdirSync(path.join(dataRoot, 'orders'))
    expect(orders, 'a ledger was filed somewhere that is not an order').toEqual([order().id])
  })
})
