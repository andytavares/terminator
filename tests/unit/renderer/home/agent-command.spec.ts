// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentCommand } from '../../../../src/renderer/components/home/start-work'

// The line Start work types into a terminal is run by a real shell here, with a `claude` that
// prints one argument per line, so quoting that only looks right cannot pass.

let stubDirectory: string

beforeAll(() => {
  stubDirectory = mkdtempSync(join(tmpdir(), 'agent-command-'))
  const stub = join(stubDirectory, 'claude')
  writeFileSync(
    stub,
    '#!/bin/sh\nprintf "%s\\n" "$#"\nfor argument in "$@"; do printf "%s\\n" "$argument"; done\n'
  )
  chmodSync(stub, 0o755)
})

afterAll(() => rmSync(stubDirectory, { recursive: true, force: true }))

/** What `claude` was started with: how many arguments, then each one. */
function argvOf(line: string): string[] {
  const output = execFileSync('sh', ['-c', line], {
    env: { PATH: `${stubDirectory}:/usr/bin:/bin` },
    encoding: 'utf8',
  })
  return output.replace(/\n$/, '').split('\n')
}

describe('agentCommand run by sh', () => {
  it.each([
    ['a single quote', "fix the dev's build", "fix the dev's build"],
    ['a dollar sign', 'keep $HOME and ${PATH} as written', 'keep $HOME and ${PATH} as written'],
    ['backticks and a substitution', 'run `whoami` and $(id)', 'run `whoami` and $(id)'],
    ['double quotes and a backslash', 'say "hi" \\ there', 'say "hi" \\ there'],
    ['newlines and tabs', 'line one\nline two\t\tend', 'line one line two end'],
    ['a semicolon and a pipe', 'a; rm -rf / | cat && b', 'a; rm -rf / | cat && b'],
  ])('passes %s through as one argument', (_label, prompt, expected) => {
    const line = agentCommand(prompt)
    expect(line).not.toBeNull()
    expect(argvOf(line as string)).toEqual(['1', expected])
  })

  it('starts claude with no arguments when there is no prompt', () => {
    expect(argvOf(agentCommand(null) as string)).toEqual(['0'])
  })

  it('refuses a prompt whose line would pass the terminal limit', () => {
    expect(agentCommand('x'.repeat(2000))).toBeNull()
  })
})
