import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  decideByAutonomy,
  isDestructive,
  writesOutside,
} from '../../src/runtime/autonomy-policy.js'
import type { Autonomy } from '../../src/gates/autonomy.js'

// FR-029: every action is held against a decision — automatic where the
// setting allows it, and by asking where it does not. The automatic half did
// not exist. A live run sat for half an hour with a clean worktree and an
// agent waiting on a click nobody was there to make.
//
// FR-050 is the other end: four things ask at every setting. Two are gates;
// the two that are tool calls are here.

const WORKTREE = '/data/orders/WO-1/worktrees/app'

function decide(
  toolName: string,
  input: unknown,
  autonomy: Autonomy = 'standard',
  worktreePath = WORKTREE
) {
  return decideByAutonomy({ toolName, input, autonomy, worktreePath })
}

const bash = (command: string) => ({ command })

describe('ordinary work inside the checkout', () => {
  it('is taken automatically once the operator is past escorted', () => {
    const taken = decide('Edit', { file_path: `${WORKTREE}/src/session.js` })
    expect(taken?.allow).toBe(true)
  })

  it('is taken at the most permissive setting too', () => {
    expect(decide('Write', { file_path: `${WORKTREE}/src/new.js` }, 'lights-out')?.allow).toBe(true)
  })

  it('still asks at escorted, which is the setting whose meaning is "ask me"', () => {
    expect(decide('Edit', { file_path: `${WORKTREE}/src/session.js` }, 'escorted')).toBeNull()
  })

  it('takes a test run, which is most of what a unit does', () => {
    expect(decide('Bash', bash('npm test'))?.allow).toBe(true)
  })

  it('takes a tool it has never heard of, when nothing about it is destructive', () => {
    // The read-only policy refuses the unknown because a review may only read.
    // This one is deciding for a role that may write, so the unknown is
    // ordinary work rather than a threat.
    expect(decide('SomeNewTool', { anything: true })?.allow).toBe(true)
  })

  it('says which setting took it, so the record can name the reason', () => {
    expect(decide('Edit', { file_path: `${WORKTREE}/a.js` })?.reason).toContain('standard')
  })
})

describe('a destructive action (FR-050)', () => {
  const DESTRUCTIVE = [
    'rm -rf build',
    'rm src/session.js',
    'git reset --hard origin/main',
    'git clean -fd',
    'git push --force origin main',
    'git push --force-with-lease',
    'git branch -D main',
    'git rebase -i main',
    'shred -u secrets.txt',
    'dd if=/dev/zero of=disk.img',
    'chmod -R 777 /',
    'pkill -f node',
  ]

  it.each(DESTRUCTIVE)('asks about `%s` at every setting', (command) => {
    for (const autonomy of ['escorted', 'standard', 'lights-out'] as Autonomy[]) {
      expect(decide('Bash', bash(command), autonomy), `${command} at ${autonomy}`).toBeNull()
    }
  })

  it.each(DESTRUCTIVE)('recognises `%s` as destructive', (command) => {
    expect(isDestructive('Bash', bash(command))).toBe(true)
  })

  it('asks about anything it cannot parse, rather than assuming it is safe', () => {
    // The hole the read-only policy documents: reading `git status` off the
    // front of `git status; rm -rf .` is reading the wrong command.
    expect(isDestructive('Bash', bash('git status; rm -rf .'))).toBe(true)
    expect(isDestructive('Bash', bash('npm test && rm -rf node_modules'))).toBe(true)
    expect(isDestructive('Bash', bash('echo $(rm -rf x)'))).toBe(true)
    expect(decide('Bash', bash('git status; rm -rf .'), 'lights-out')).toBeNull()
  })

  it('takes the ordinary git a unit actually runs', () => {
    for (const command of ['git status', 'git diff', 'git add -A', 'git commit -m x', 'git log']) {
      expect(isDestructive('Bash', bash(command)), command).toBe(false)
      expect(decide('Bash', bash(command))?.allow, command).toBe(true)
    }
  })

  it('is not confused by a path to the binary', () => {
    expect(isDestructive('Bash', bash('/bin/rm -rf build'))).toBe(true)
  })

  it('is never claimed of a tool that is not a shell', () => {
    expect(isDestructive('Edit', { file_path: '/x/rm -rf' })).toBe(false)
  })

  // Every compound command used to be called destructive, on the reasoning
  // that a shell might be doing something other than the first word. But that
  // does not stop at the dangerous ones: `pwd && git status` and
  // `npm test 2>&1 | tail -20` are the ordinary sentences every agent writes,
  // and each was classified as destroying work and sent to an operator — at
  // every setting, lights-out included. Which is why builders sat doing
  // nothing while the graph said `running` and the worktree stayed clean.
  describe('a command joined to another command', () => {
    const ORDINARY = [
      'pwd && git rev-parse --abbrev-ref HEAD && git status --short',
      'npm test 2>&1 | tail -20',
      'grep -rn TTL . | head -20',
      'cd src && cat session.js',
      'ls -la; cat package.json',
      'npm run lint 2>/dev/null | tail -5',
    ]

    it.each(ORDINARY)('takes `%s` without asking anyone', (command) => {
      expect(isDestructive('Bash', bash(command))).toBe(false)
      expect(decide('Bash', bash(command))?.allow).toBe(true)
    })

    it('still catches the destructive half, wherever it sits', () => {
      expect(isDestructive('Bash', bash('npm test && git reset --hard'))).toBe(true)
      expect(isDestructive('Bash', bash('ls; git clean -fd'))).toBe(true)
      expect(isDestructive('Bash', bash('cat x | rm -rf y'))).toBe(true)
    })

    it('reads the binary past a leading environment assignment', () => {
      expect(isDestructive('Bash', bash('CI=1 npm test'))).toBe(false)
      expect(isDestructive('Bash', bash('CI=1 FORCE=1 rm -rf build'))).toBe(true)
    })

    it('still asks about a command built inside another, which it cannot read', () => {
      expect(isDestructive('Bash', bash('echo $(rm -rf x)'))).toBe(true)
      expect(isDestructive('Bash', bash('echo `rm -rf x`'))).toBe(true)
    })
  })
})

describe('a write outside the checkout (FR-050)', () => {
  it('asks, at every setting', () => {
    for (const autonomy of ['standard', 'lights-out'] as Autonomy[]) {
      expect(decide('Write', { file_path: '/etc/hosts' }, autonomy)).toBeNull()
    }
  })

  it('recognises the path as outside', () => {
    expect(writesOutside('Write', { file_path: '/etc/hosts' }, WORKTREE)).toBe(true)
    expect(writesOutside('Edit', { file_path: `${WORKTREE}/../other/x.js` }, WORKTREE)).toBe(true)
  })

  it('is not fooled by a sibling directory that shares the prefix', () => {
    expect(writesOutside('Write', { file_path: `${WORKTREE}-other/x.js` }, WORKTREE)).toBe(true)
  })

  it('allows the checkout itself and everything under it', () => {
    expect(writesOutside('Edit', { file_path: `${WORKTREE}/src/deep/x.js` }, WORKTREE)).toBe(false)
    expect(writesOutside('Edit', { file_path: WORKTREE }, WORKTREE)).toBe(false)
  })

  it('says nothing about a relative path, which resolves against the checkout', () => {
    expect(writesOutside('Edit', { file_path: 'src/session.js' }, WORKTREE)).toBe(false)
  })

  it('says nothing when there is no checkout to be outside of', () => {
    expect(writesOutside('Write', { file_path: '/etc/hosts' }, '')).toBe(false)
  })

  // A shell redirection is a write, and it names its file in the command
  // rather than in a field. It used to be covered by accident — every command
  // containing `>` was called destructive — so dropping that blanket test
  // without reading the redirect would have quietly lost FR-050 here.
  describe('a redirection, which writes the file it names', () => {
    it('asks when it writes outside the checkout', () => {
      expect(writesOutside('Bash', bash('echo hi > /etc/hosts'), '/work/checkout')).toBe(true)
      expect(writesOutside('Bash', bash('npm test >> /work/other/out.log'), '/work/checkout')).toBe(
        true
      )
    })

    it('takes one inside it, which is a unit writing its own files', () => {
      expect(writesOutside('Bash', bash('echo hi > notes.txt'), '/work/checkout')).toBe(false)
      expect(
        writesOutside('Bash', bash('npm test > /work/checkout/out.log'), '/work/checkout')
      ).toBe(false)
    })

    it('says nothing about a discard, which writes nothing', () => {
      expect(writesOutside('Bash', bash('npm test 2>/dev/null'), '/work/checkout')).toBe(false)
      expect(writesOutside('Bash', bash('ls 2>&1'), '/work/checkout')).toBe(false)
    })

    it('says nothing about a shell command that redirects nowhere', () => {
      expect(writesOutside('Bash', bash('npm test'), '/work/checkout')).toBe(false)
    })
  })

  // macOS hands out `/var/folders/…` and `/private/var/folders/…` for the same
  // directory, and `path.resolve` does not follow symlinks. A checkout known by
  // one name and a file written under the other read as different places, so
  // every ordinary edit inside the unit's own worktree asked — at every
  // setting. The same coin flip that left agents sitting at the trust dialog.
  describe('a directory with two names', () => {
    let checkout: string

    beforeEach(() => {
      checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-outside-'))
      fs.mkdirSync(path.join(checkout, 'src'))
    })

    afterEach(() => {
      fs.rmSync(checkout, { recursive: true, force: true })
    })

    it("takes a file under the checkout's other name", () => {
      const other = fs.realpathSync(checkout)
      expect(other).not.toBe(checkout)
      expect(writesOutside('Edit', { file_path: path.join(other, 'src/a.ts') }, checkout)).toBe(
        false
      )
    })

    it('takes a file that does not exist yet, which is most of what a builder writes', () => {
      const other = fs.realpathSync(checkout)
      expect(
        writesOutside('Edit', { file_path: path.join(other, 'deep/er/new.ts') }, checkout)
      ).toBe(false)
    })

    it('still asks about a path that is genuinely elsewhere', () => {
      expect(writesOutside('Edit', { file_path: '/etc/hosts' }, checkout)).toBe(true)
      expect(writesOutside('Edit', { file_path: '/work/other/x.ts' }, checkout)).toBe(true)
    })
  })

  it('reads the path from whichever field the tool names it in', () => {
    expect(writesOutside('NotebookEdit', { notebook_path: '/etc/x.ipynb' }, WORKTREE)).toBe(true)
    expect(writesOutside('Read', { path: '/etc/hosts' }, WORKTREE)).toBe(true)
  })
})

describe('what this is not', () => {
  it('never refuses — it either takes the decision or leaves it to the operator', () => {
    const answers = [
      decide('Edit', { file_path: `${WORKTREE}/a.js` }),
      decide('Bash', bash('rm -rf /')),
      decide('Write', { file_path: '/etc/hosts' }),
      decide('Edit', { file_path: `${WORKTREE}/a.js` }, 'escorted'),
    ]
    for (const answer of answers) expect(answer?.allow ?? true).toBe(true)
  })
})

// Both of these were measured on WO-0910-1fb, an order whose whole content was
// "make all text red". Thirteen of its builder's 131 tool calls were held by
// this policy, and those thirteen ate 16.6 of the run's 26.7 minutes of tool
// time — a mean of 77 seconds against 5 for a call that was taken. Each hold
// waits `DEFAULT_ASK_AFTER_MS` (five minutes) before handing back to a
// terminal nobody is sitting at, so a policy that asks by accident does not
// cost a click. It costs five minutes.
describe('a discard, wherever the shell puts its punctuation', () => {
  // `DISCARDS` required whitespace or end-of-string after `/dev/null`, so the
  // discard was only recognised in the one spelling that happens to have a
  // space in front of the next operator. Every other spelling left `/dev/null`
  // standing as a redirect target, which is outside any checkout — so a bare
  // `ls` was held for 322 seconds.
  const WT = '/work/checkout'

  it('is a discard when an operator follows it with no space', () => {
    expect(writesOutside('Bash', bash('ls a 2>/dev/null; echo x'), WT)).toBe(false)
    expect(writesOutside('Bash', bash('ls a 2>/dev/null|head'), WT)).toBe(false)
    expect(writesOutside('Bash', bash('ls a 2>/dev/null&& echo x'), WT)).toBe(false)
    expect(writesOutside('Bash', bash('(ls a 2>/dev/null)'), WT)).toBe(false)
    expect(writesOutside('Bash', bash('ls a 2>/dev/null\necho x'), WT)).toBe(false)
  })

  it('is a discard for stdout as well as stderr', () => {
    expect(writesOutside('Bash', bash('npm run lint >/dev/null; echo $?'), WT)).toBe(false)
    expect(writesOutside('Bash', bash('npm run lint &>/dev/null; echo $?'), WT)).toBe(false)
  })

  it('reads the real command from the run that found this', () => {
    const real =
      'ls node_modules 2>/dev/null | head -3 ; echo "present: $?"; ' +
      'ls -d node_modules/.bin 2>/dev/null; echo "---"; ls -la | head -20'
    expect(writesOutside('Bash', bash(real), WT)).toBe(false)
    expect(decide('Bash', bash(real), 'standard', WT)?.allow).toBe(true)
  })

  it('still reads a real file next to a discard', () => {
    expect(writesOutside('Bash', bash('ls 2>/dev/null > /work/other/out.log'), WT)).toBe(true)
  })
})

// The harness an agent runs inside gives it a scratchpad under the OS temp
// directory and tells it, in its own system prompt, to put intermediate files
// there. This policy called every one of those a write outside the checkout,
// so the agent obeyed its harness and Foundry held it: 195 seconds to write
// one throwaway `.mjs`, and more for each `> $SP/…` after it.
//
// A temp file is not what this rule protects. It is disposable by definition,
// the operator will never see it, and nothing is lost if it is wrong. The
// trade-off, stated: an operator who configures `foundry.dataDir` *inside* the
// OS temp directory gives up cross-checkout protection with it. The default is
// `<workdir>/.foundry`, and a data root in temp does not survive a reboot.
describe('a scratch file, where the harness tells the agent to put one', () => {
  const WT = '/work/checkout'

  it('is taken without asking, under any of the temp roots', () => {
    for (const root of [os.tmpdir(), '/tmp', '/private/tmp']) {
      expect(writesOutside('Write', { file_path: path.join(root, 'probe.mjs') }, WT)).toBe(false)
      expect(writesOutside('Bash', bash(`npm test > ${path.join(root, 'out.log')}`), WT)).toBe(
        false
      )
    }
  })

  it('is taken for the session scratchpad the harness actually hands out', () => {
    const scratch = path.join(os.tmpdir(), 'claude-501', 'a-project', 'a-session', 'scratchpad')
    expect(writesOutside('Write', { file_path: path.join(scratch, 'nontext.mjs') }, WT)).toBe(false)
    expect(
      decide('Bash', bash(`cat > ${scratch}/ramp.mjs <<'EOF'\nx\nEOF`), 'standard', WT)?.allow
    ).toBe(true)
  })

  it('still asks about everywhere else outside the checkout', () => {
    expect(writesOutside('Write', { file_path: '/etc/hosts' }, WT)).toBe(true)
    expect(writesOutside('Write', { file_path: '/work/other/src/a.ts' }, WT)).toBe(true)
    expect(writesOutside('Write', { file_path: path.join(os.homedir(), '.zshrc') }, WT)).toBe(true)
  })

  it('does not make a destructive command ordinary just because it is in temp', () => {
    expect(decide('Bash', bash(`rm -rf ${os.tmpdir()}/x`), 'lights-out', WT)).toBeNull()
  })
})
