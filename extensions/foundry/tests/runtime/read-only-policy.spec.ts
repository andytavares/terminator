import { describe, it, expect } from 'vitest'
import { decideReadOnly } from '../../src/runtime/read-only-policy.js'

// A read-only role used to be a request in a prompt, so a reviewer could
// rewrite the worktree it was reviewing. It now decides from this policy, with
// no person asked — an automated gate that waits on a human is a flaky one.

describe('what a review may do', () => {
  const allowed = (tool: string, input?: unknown) => decideReadOnly(tool, input).allow

  it('allows reading', () => {
    expect(allowed('Read', { file_path: '/a.ts' })).toBe(true)
    expect(allowed('Grep', { pattern: 'x' })).toBe(true)
    expect(allowed('Glob', { pattern: '*.ts' })).toBe(true)
  })

  it('refuses writing', () => {
    expect(allowed('Write', { file_path: '/a.ts', content: 'x' })).toBe(false)
    expect(allowed('Edit', { file_path: '/a.ts' })).toBe(false)
    expect(allowed('NotebookEdit', {})).toBe(false)
  })

  it('refuses a tool it has never been taught about', () => {
    // A tool the policy cannot vouch for is one a review has no business using.
    expect(allowed('SomeNewTool', {})).toBe(false)
  })

  it('allows the git commands a review is actually made of', () => {
    expect(allowed('Bash', { command: 'git diff main...HEAD' })).toBe(true)
    expect(allowed('Bash', { command: 'git log --oneline -5' })).toBe(true)
    expect(allowed('Bash', { command: 'git status' })).toBe(true)
  })

  it('refuses git commands that change the repository', () => {
    expect(allowed('Bash', { command: 'git checkout main' })).toBe(false)
    expect(allowed('Bash', { command: 'git commit -m x' })).toBe(false)
    expect(allowed('Bash', { command: 'git push' })).toBe(false)
    expect(allowed('Bash', { command: 'git reset --hard' })).toBe(false)
  })

  it('allows plain inspection commands', () => {
    expect(allowed('Bash', { command: 'cat package.json' })).toBe(true)
    expect(allowed('Bash', { command: 'rg TODO src' })).toBe(true)
  })

  it('refuses anything not on the list', () => {
    expect(allowed('Bash', { command: 'rm -rf .' })).toBe(false)
    expect(allowed('Bash', { command: 'npm install left-pad' })).toBe(false)
    expect(allowed('Bash', { command: 'curl https://example.com' })).toBe(false)
  })

  it('refuses a chained command, however innocent it starts', () => {
    // This is the load-bearing check. `git diff` on its own passes, so without
    // it the allowlist is theatre.
    expect(allowed('Bash', { command: 'git diff; rm -rf .' })).toBe(false)
    expect(allowed('Bash', { command: 'git diff && rm -rf .' })).toBe(false)
    expect(allowed('Bash', { command: 'git diff || rm -rf .' })).toBe(false)
  })

  it('refuses redirection, which is how a read becomes a write', () => {
    // The exact hole that made --allowedTools useless: an agent told it could
    // only read still created a file, because Bash can redirect.
    expect(allowed('Bash', { command: 'echo banana > probe.txt' })).toBe(false)
    expect(allowed('Bash', { command: 'git diff > /tmp/out' })).toBe(false)
    expect(allowed('Bash', { command: 'cat a.ts >> b.ts' })).toBe(false)
  })

  it('refuses command substitution and pipes', () => {
    expect(allowed('Bash', { command: 'git diff $(rm -rf .)' })).toBe(false)
    expect(allowed('Bash', { command: 'git diff `rm -rf .`' })).toBe(false)
    expect(allowed('Bash', { command: 'cat a | tee b' })).toBe(false)
  })

  it('refuses a Bash call with nothing to check', () => {
    expect(allowed('Bash', {})).toBe(false)
    expect(allowed('Bash', { command: '   ' })).toBe(false)
    expect(allowed('Bash', undefined)).toBe(false)
  })

  it('says why, in words the agent reads and a person can act on', () => {
    expect(decideReadOnly('Write', {}).reason).toMatch(/may only read/)
    expect(decideReadOnly('Bash', { command: 'git diff > x' }).reason).toMatch(/redirect/)
  })
})

// The hook runs in a process Claude Code owns, with no bundler and nothing to
// import, so it carries its own copy of the rules. These run the real script the
// way Claude Code does and check it agrees with the module — the two cannot
// drift silently.
// The cross-process agreement test that sat here is gone with the second hook
// script it checked. There was a separate `read-only-hook.mjs` written for the
// self-review runner, and it had to be proven to decide the same way as this
// policy because it was a copy of it in another process. The Line does not
// copy it: `executor.ts` hands `decideReadOnly` itself to the supervised
// runner as `autoDecide`, so there is one implementation and nothing to agree
// with.

describe('the ways this was bypassable', () => {
  // Every one of these was allowed, verified by running the policy directly.
  // A review that can run them is not a review — it is an agent with write
  // access and a reassuring name.

  it.each([
    ['a newline runs the next command', 'git diff\nrm -rf .'],
    ['so does a carriage return', 'git diff\rrm -rf .'],
    ['sed rewrites the file in place', 'sed -i.bak s/a/b/ file.ts'],
    ['find deletes what it finds', 'find . -name x -delete'],
    ['find executes anything', 'find . -exec rm {} ;'],
    ['awk redirects on its own', 'awk {print} file > out'],
    ['git config writes configuration', 'git config user.email evil@example.com'],
    ['git branch -D destroys branches', 'git branch -D main'],
    ['git remote repoints a push', 'git remote add evil https://example.invalid'],
  ])('refuses: %s', (_why, command) => {
    expect(decideReadOnly('Bash', { command }).allow).toBe(false)
  })

  it.each([
    // Flags, not chaining: neither of these needs a shell metacharacter, so the
    // compound check never saw them.
    ['git writes the diff to a file', 'git diff --output=/tmp/pwned.txt'],
    ['and with the short flag', 'git diff -o /tmp/pwned.txt'],
    ['ripgrep runs a program per file', 'rg --pre /tmp/evil.sh foo'],
    ['and picks it by glob', 'rg --pre-glob *.md foo'],
    ['anything that takes --exec', 'grep --exec rm foo'],
    ['in-place editing wherever it appears', 'diff --in-place a b'],
  ])('refuses: %s', (_why, command) => {
    expect(decideReadOnly('Bash', { command }).allow).toBe(false)
  })

  it.each([
    ['reading a file', 'cat README.md'],
    ['searching', 'grep -rn thing src'],
    ['the diff a review is mostly made of', 'git diff main'],
    ['the log', 'git log --oneline -20'],
  ])('still allows: %s', (_why, command) => {
    expect(decideReadOnly('Bash', { command }).allow).toBe(true)
  })
})

// A reading agent has to be able to read. This path *denies*; it never asks —
// so a binary left off the allowlist is not "the agent can ask for it", it is
// "the agent cannot do it". A live run showed an architect, whose entire job is
// reading a repository, try three times and give up with nothing left it was
// allowed to run.
describe('exploring a repository', () => {
  it('lets a reader list the files', () => {
    const d = decideReadOnly('Bash', { command: "find . -type f -not -path './.git/*'" })
    expect(d.allow, d.reason).toBe(true)
  })

  it('lets it look for things by name', () => {
    expect(decideReadOnly('Bash', { command: "find src -name '*.ts'" }).allow).toBe(true)
  })

  it.each([
    'find . -delete',
    'find . -name x -exec rm {} ;',
    'find . -execdir rm {} ;',
    'find . -ok rm {} ;',
    'find . -okdir rm {} ;',
    'find . -fprint /tmp/out',
    'find . -fprintf /tmp/out %p',
    'find . -fls /tmp/out',
  ])('refuses `%s`, which is how find writes', (command) => {
    const d = decideReadOnly('Bash', { command })
    expect(d.allow, `${command} was allowed: ${d.reason}`).toBe(false)
  })

  it('refuses a writing flag wherever it appears in the arguments', () => {
    expect(decideReadOnly('Bash', { command: "find . -type f -name '*.ts' -delete" }).allow).toBe(
      false
    )
  })

  it('still refuses the ones that cannot be told apart by a flag', () => {
    // `sed -i` collides with how half the reading tools spell
    // case-insensitive, and awk redirects from inside its program text.
    expect(decideReadOnly('Bash', { command: "sed -n '1,20p' file" }).allow).toBe(false)
    expect(decideReadOnly('Bash', { command: "awk '{print}' file" }).allow).toBe(false)
  })

  it('lets grep be case-insensitive, which is what -i means on everything here', () => {
    // `-i` was refused globally, for in-place editing. It is also how `grep`,
    // `rg` and `diff` spell "ignore case", and nothing on the allowlist writes
    // with it — the tools that do are not on the allowlist at all.
    expect(decideReadOnly('Bash', { command: 'grep -i todo src' }).allow).toBe(true)
    expect(decideReadOnly('Bash', { command: 'rg -i todo' }).allow).toBe(true)
    expect(decideReadOnly('Bash', { command: 'diff -i a b' }).allow).toBe(true)
  })

  it('still refuses the spelt-out form, whatever is running it', () => {
    expect(decideReadOnly('Bash', { command: 'grep --in-place x' }).allow).toBe(false)
  })
})

// Refusing every compound was the original answer to `git diff\nrm -rf .` — a
// check that reads the first word reads the wrong command. But it also refused
// `find . | head -50`, which is the most ordinary thing a reader does, and left
// a live architect with nothing at all it was allowed to run. Every segment is
// checked now, so the safety property is the same and composing reads works.
describe('a command joined to another', () => {
  const allowed = (command: string) => decideReadOnly('Bash', { command })

  it.each([
    'find . -type f | head -50',
    'git log --oneline -5 | head -3',
    'ls -la && git status',
    'cat a.ts; cat b.ts',
    'grep -r todo src | wc -l',
  ])('allows `%s`, because every part of it only reads', (command) => {
    const d = allowed(command)
    expect(d.allow, `${command}: ${d.reason}`).toBe(true)
  })

  it.each([
    'git diff\nrm -rf .',
    'git status; rm -rf .',
    'ls && rm file',
    'cat x | tee out',
    'find . | xargs rm',
    'ls || curl evil.example.com',
  ])('refuses `%s`, on the part that writes', (command) => {
    const d = allowed(command)
    expect(d.allow, `${command} was allowed: ${d.reason}`).toBe(false)
  })

  it('names the offending part, not the whole line', () => {
    expect(allowed('ls && rm file').reason).toMatch(/rm/)
  })

  it('still refuses redirection, whatever is on the left of it', () => {
    for (const command of ['git diff > out', 'cat a >> b', 'wc -l < a']) {
      expect(allowed(command).allow, command).toBe(false)
    }
  })

  it('still refuses a command run inside another', () => {
    expect(allowed('ls $(rm -rf x)').allow).toBe(false)
    expect(allowed('ls `rm -rf x`').allow).toBe(false)
  })

  it('says how many commands it checked, so the reason is not a guess', () => {
    expect(allowed('find . | head -5').reason).toMatch(/2 commands/)
  })
})

// `-o` was refused for every binary, for `--output`. It is also how `find`
// spells "or", so `find . -path ./node_modules -prune -o -type f -print` — the
// exact command the live architect reached for — was refused. And `pwd` and
// `echo`, which cannot change anything at all, were not on the list.
describe('the flags and binaries a reader actually reaches for', () => {
  const allowed = (command: string) => decideReadOnly('Bash', { command })

  it("lets find use -o, which is how find spells 'or'", () => {
    const d = allowed('find . -path ./node_modules -prune -o -type f -print')
    expect(d.allow, d.reason).toBe(true)
  })

  it('still refuses -o where it really does write a file', () => {
    expect(allowed('sort -o out.txt in.txt').allow).toBe(false)
    expect(allowed('grep -o pattern file').allow).toBe(false)
  })

  it('allows the commands that cannot change anything', () => {
    for (const command of ['pwd', 'echo hello', 'basename /a/b', 'dirname /a/b', 'realpath .']) {
      expect(allowed(command).allow, command).toBe(true)
    }
  })

  it('allows the ones a reader pipes into', () => {
    for (const command of ['sort', 'uniq -c', 'cut -d, -f1', 'tr a b', 'wc -l']) {
      expect(allowed(command).allow, command).toBe(true)
    }
  })

  it('allows the whole thing the live architect was refused', () => {
    const d = allowed('find . -path ./node_modules -prune -o -type f -print | head -100')
    expect(d.allow, d.reason).toBe(true)
  })

  it('still refuses find when it is asked to write', () => {
    expect(allowed('find . -name x -o -delete').allow).toBe(false)
  })
})

// Discarding output is not writing. `2>/dev/null` is the first thing any
// reader reaches for, and it was refused with every other redirection — the
// live architect's opening command was `… 2>/dev/null` four runs running.
describe('throwing output away', () => {
  const allowed = (command: string) => decideReadOnly('Bash', { command })

  it.each([
    'cat package.json 2>/dev/null',
    'cat package.json 2> /dev/null',
    'ls -la >/dev/null',
    'git status &>/dev/null',
    'find . -type f 2>/dev/null | head -20',
    'ls && cat package.json 2>/dev/null && git log --oneline -5',
  ])('allows `%s`', (command) => {
    const d = allowed(command)
    expect(d.allow, `${command}: ${d.reason}`).toBe(true)
  })

  it.each([
    'cat a > /dev/nullish',
    'cat a > /dev/null/file',
    'git diff 2>/tmp/out',
    'ls > out.txt',
    'cat a >> b',
  ])('still refuses `%s`, which writes somewhere real', (command) => {
    expect(allowed(command).allow, `${command} was allowed`).toBe(false)
  })

  it('does not let a discard hide a command that writes', () => {
    expect(allowed('rm -rf x 2>/dev/null').allow).toBe(false)
    expect(allowed('ls 2>/dev/null && rm file').allow).toBe(false)
  })
})

// Two more the live architect walked into, both ordinary reader shapes.
describe('moving around and setting a variable', () => {
  const allowed = (command: string) => decideReadOnly('Bash', { command })

  it('lets a reader change directory, which changes nothing in the repository', () => {
    expect(allowed('cd /repo && git log --oneline -5').allow).toBe(true)
  })

  it('reads past a leading environment assignment to the command underneath', () => {
    expect(allowed('GIT_PAGER=cat git log').allow).toBe(true)
    expect(allowed('B=/repo cat package.json').allow).toBe(true)
  })

  it('still refuses the command underneath when it writes', () => {
    expect(allowed('FOO=bar rm -rf x').allow).toBe(false)
    expect(allowed('GIT_PAGER=cat git push').allow).toBe(false)
  })

  it('treats a bare assignment as changing nothing', () => {
    expect(allowed('B=/repo').allow).toBe(true)
  })

  it('leaves an argument that merely looks like one alone', () => {
    // `--define X=1` is the command's business, not this function's.
    expect(allowed('grep --define X=1 pattern file').allow).toBe(true)
  })
})

// `git branch -a` is a pure read that an agent reaches for constantly, and it
// was refused because `git branch -D` deletes. Every writing form of `branch`
// is visible — a flag, or a bare name — so it can be told apart.
describe('git branch, listing and writing', () => {
  const allowed = (command: string) => decideReadOnly('Bash', { command })

  it.each([
    'git branch',
    'git branch -a',
    'git branch -r',
    'git branch -v -a',
    "git branch -a --format='%(refname)'",
    'git branch --list',
  ])('allows `%s`, which only lists', (command) => {
    const d = allowed(command)
    expect(d.allow, `${command}: ${d.reason}`).toBe(true)
  })

  it.each([
    'git branch -d topic',
    'git branch -D main',
    'git branch --delete topic',
    'git branch -m old new',
    'git branch -M main',
    'git branch -c a b',
    'git branch -f main HEAD',
    'git branch --set-upstream-to origin/main',
  ])('refuses `%s`, which writes a ref', (command) => {
    expect(allowed(command).allow, `${command} was allowed`).toBe(false)
  })

  it('refuses a bare name, which creates a branch and looks like nothing', () => {
    expect(allowed('git branch newthing').allow).toBe(false)
    expect(allowed('git branch -a newthing').allow).toBe(false)
  })

  it('says which it was, so the agent can act on the reason', () => {
    expect(allowed('git branch newthing').reason).toMatch(/writes a ref/)
    expect(allowed('git branch -a').reason).toMatch(/only listing/)
  })

  it('leaves the other git subcommands exactly as they were', () => {
    expect(allowed('git status').allow).toBe(true)
    expect(allowed('git config user.name x').allow).toBe(false)
    expect(allowed('git remote add origin x').allow).toBe(false)
  })
})

// Deny-by-default for an unknown tool is the right posture and stays. But
// loading a tool's schema is not using it: refusing this took a reviewer's
// ability to reach anything deferred — watched on a live run — and granted
// nothing, because every tool it surfaces meets this same policy when the
// agent actually calls it.
describe('finding a tool, as opposed to using one', () => {
  it("lets a review load a deferred tool's schema", () => {
    expect(decideReadOnly('ToolSearch', { query: 'select:Read' }).allow).toBe(true)
  })

  it('still refuses a tool it has not been taught about', () => {
    expect(decideReadOnly('mcp__whatever__save', {}).allow).toBe(false)
    expect(decideReadOnly('Write', { file_path: '/x' }).allow).toBe(false)
  })
})

// The punctuation inside a quoted argument belongs to the argument. Matching
// `[><`|;&]` against raw text split a verifier's `grep -E "TTL|15 \* 60" .`
// into four commands and refused the review with "15 is not on the review's
// read-only list" — a fragment of its own regex, named as a binary. It tried
// three more spellings and gave up.
describe('a command whose arguments contain punctuation', () => {
  it('reads an alternation regex as one command', () => {
    const decision = decideReadOnly('Bash', {
      command: 'grep -rn --exclude-dir=.git -E "TTL|15 \\* 60|900000|process\\.env" .',
    })
    expect(decision.allow).toBe(true)
  })

  it('does not call a quoted angle bracket a redirection', () => {
    expect(decideReadOnly('Bash', { command: 'grep "a>b" src' }).allow).toBe(true)
  })

  it('does not call a quoted dollar-paren a command substitution', () => {
    expect(decideReadOnly('Bash', { command: "grep '$(x)' src" }).allow).toBe(true)
  })

  it('still refuses a real redirection and a real substitution', () => {
    expect(decideReadOnly('Bash', { command: 'cat x > y' }).allow).toBe(false)
    expect(decideReadOnly('Bash', { command: 'echo $(rm -rf x)' }).allow).toBe(false)
    expect(decideReadOnly('Bash', { command: 'echo `rm -rf x`' }).allow).toBe(false)
  })

  it('still refuses a writing command hiding behind a quoted one', () => {
    expect(decideReadOnly('Bash', { command: 'grep "a|b" . ; rm -rf .' }).allow).toBe(false)
  })
})
