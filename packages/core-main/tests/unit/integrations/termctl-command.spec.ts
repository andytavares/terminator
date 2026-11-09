import { describe, it, expect } from 'vitest'
import { administratorScript, launcherScript } from '../../../src/integrations/termctl-command'

describe('the termctl launcher', () => {
  it('runs termctl.mjs in node mode with the app socket, and passes every argument on', () => {
    const script = launcherScript({
      execPath: '/Applications/Terminator.app/Contents/MacOS/Terminator',
      scriptPath: '/Applications/Terminator.app/Contents/Resources/termctl/termctl.mjs',
      socketPath: '/Users/ana/Library/Application Support/Terminator/mcp.sock',
    })
    expect(script.split('\n')).toEqual([
      '#!/bin/sh',
      '# Written by Terminator. Do not edit: it is overwritten on every start.',
      'export ELECTRON_RUN_AS_NODE=1',
      "export TERMINATOR_MCP_SOCKET='/Users/ana/Library/Application Support/Terminator/mcp.sock'",
      "exec '/Applications/Terminator.app/Contents/MacOS/Terminator' '/Applications/Terminator.app/Contents/Resources/termctl/termctl.mjs' \"$@\"",
      '',
    ])
  })
})

describe('the administrator prompt', () => {
  it('escapes the backslash of a shell-quoted apostrophe, so AppleScript reads one string', () => {
    const line = `rm '/usr/local/bin/o'\\''brien'`
    expect(administratorScript(line)).toBe(
      `do shell script "rm '/usr/local/bin/o'\\\\''brien'" with administrator privileges`
    )
  })
})
