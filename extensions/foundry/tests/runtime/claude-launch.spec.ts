import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, it, expect } from 'vitest'
import { homedir } from 'os'
import { transcriptPathFor, resumableIn } from '../../src/runtime/claude-launch.js'
import { makeTempDir } from '../../../../tests/support/temp-dir'

// A conversation is filed under the directory it ran in. One begun elsewhere —
// an architect that ran on the repository root before ADR-061 — cannot be
// resumed from the order's checkout, and `--resume` on it would end the turn.
describe('resumableIn', () => {
  it('resumes a conversation filed under this directory', () => {
    const home = makeTempDir('resumable-')
    const file = transcriptPathFor('/wt/order', 'sid', home)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '{}\n')
    expect(resumableIn('/wt/order', 'sid', home)).toBe('sid')
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('starts fresh when the conversation was filed under another directory', () => {
    const home = makeTempDir('resumable-')
    const file = transcriptPathFor('/repos/a', 'sid', home)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '{}\n')
    expect(resumableIn('/wt/order', 'sid', home)).toBeUndefined()
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('starts fresh when there is no conversation to resume', () => {
    expect(resumableIn('/wt/order', undefined)).toBeUndefined()
  })
})

describe('transcriptPathFor', () => {
  describe('encoding', encodingTests)
  describe('resolving the directory', resolvingTheDirectoryTests)
})

function encodingTests() {
  it('encodes the working copy the way the runtime does', () => {
    // Reproduced from a real run: separators and dots both become dashes.
    expect(transcriptPathFor('/private/tmp/scratchpad/hooktest', 'sid', '/home/me')).toBe(
      '/home/me/.claude/projects/-private-tmp-scratchpad-hooktest/sid.jsonl'
    )
  })

  it('turns a dot in a directory name into a dash too', () => {
    expect(transcriptPathFor('/a/my.repo', 'sid', '/home/me')).toBe(
      '/home/me/.claude/projects/-a-my-repo/sid.jsonl'
    )
  })

  it('names the file after the session, so it is known before the run exists', () => {
    expect(transcriptPathFor('/a', 'the-session', '/home/me')).toMatch(/the-session\.jsonl$/)
  })
}

function resolvingTheDirectoryTests() {
  // The runtime encodes the directory the *process* is in, and macOS hands out
  // two names for the same one. A worktree under `/var/folders/…` is
  // `/private/var/folders/…` to the process that chdir'd into it, so this
  // predicted a path nobody was writing — and every reader of it opened
  // nothing. The ladder reported rungs that had just run and exited 0 as "not
  // measured", and the stall detector, which reads transcripts and nothing
  // else, saw an agent that had never said a word.
  it('encodes the directory as the process sees it, not as it was handed to us', () => {
    const real = makeTempDir('transcript-real-')
    const link = path.join(path.dirname(real), `link-${path.basename(real)}`)
    fs.symlinkSync(real, link)
    try {
      expect(transcriptPathFor(link, 'sid', '/home/me')).toBe(
        transcriptPathFor(fs.realpathSync(link), 'sid', '/home/me')
      )
    } finally {
      fs.unlinkSync(link)
      fs.rmSync(real, { recursive: true, force: true })
    }
  })

  it('uses the name it was given when there is nothing there to resolve', () => {
    // A worktree about to be cut. The unresolved name is the best answer
    // available, and it is right wherever the two agree.
    expect(transcriptPathFor('/a/not/here/yet', 'sid', '/home/me')).toBe(
      '/home/me/.claude/projects/-a-not-here-yet/sid.jsonl'
    )
  })
}

describe('transcriptPathFor — what it falls back to', () => {
  it('looks under the current user home, when none is named', () => {
    expect(transcriptPathFor('/a', 'sid')).toContain(homedir())
  })
})
