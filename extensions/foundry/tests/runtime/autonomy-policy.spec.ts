import { describe, it, expect } from 'vitest'
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
      expect(writesOutside('Bash', bash('npm test >> /tmp/out.log'), '/work/checkout')).toBe(true)
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
