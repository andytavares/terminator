import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

// The program Claude Code runs before every tool call.
//
// It is a file on disk rather than a module because Claude Code launches it as
// a command, in the agent's own process tree, with no knowledge of this
// application. It is carried here as source and written out at startup rather
// than shipped as an asset: the bundler produces one file per entry point and
// a loose script beside it is exactly the kind of thing that survives
// development and vanishes from the packaged app.
//
// Everything it needs is on its command line — the endpoint, the token and the
// session — so it depends on no environment the terminal may or may not have
// inherited.
//
// It fails towards `ask`. If the console is gone, restarting, or simply wrong,
// Claude Code puts its own prompt in the terminal and the operator answers it
// there. Nothing is approved silently and nothing is blocked forever. The same
// thing happens if the hook outlives its configured timeout, so a slow answer
// degrades to the prompt beside it rather than to a decision nobody made.
//
// "Nothing is blocked forever" needed the request itself to be bounded, which
// it was not: a console that accepted the connection and never answered left
// the hook waiting on its outer timeout, and that timeout is twelve hours.
//
// The output shape below was established by running claude 2.1.220, not by
// reading the reference, and it differs from the published examples in two
// ways that both fail *silently* — the tool simply proceeds as though no hook
// had run:
//
//   - `hookEventName` is required inside hookSpecificOutput. Without it the
//     whole object is ignored: allow does not approve and deny does not block.
//   - the words that reach the agent are `permissionDecisionReason`. A
//     `systemMessage` is dropped.
//
// stdout with exit 0 is the channel. The stderr-and-exit-2 form also blocks,
// but it cannot express allow or carry an edited input, so it is not enough.

export const HOOK_SCRIPT = `// Written by Terminator. Do not edit: it is overwritten on every start.
const [url, token, sessionId, kind] = process.argv.slice(2)

const ASK = JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' },
})

function answer(text) {
  process.stdout.write(text)
  process.exit(0)
}

// Bounded, because "nothing is blocked forever" was not true of an
// unanswered request. The console answers within five minutes — it hands a
// held call back to the terminal itself at that point — so ten is a bound
// that only fires when the console has genuinely stopped answering, and when
// it does this degrades exactly the way every other failure here does: to
// \`ask\`, and the operator's own prompt in the terminal beside it.
//
// Without it the only limit was the hook's own timeout, which is twelve hours
// on the tool call: one lost answer and the agent sits in silence for half a
// day, which no surface reports and only the wall-clock budget ends.
const ANSWER_WITHIN_MS = Number(process.env.TERMINATOR_HOOK_ANSWER_MS || '600000')

function post(body) {
  return fetch(url, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ANSWER_WITHIN_MS),
  })
}

let body = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  body += chunk
})
process.stdin.on('end', () => {
  // A lifecycle hook only tells the console something happened. It has nothing
  // to wait for and nothing to say to the agent, so it reports and gets out of
  // the way — including when the console is not listening.
  if (kind === 'stop' || kind === 'session_end') {
    post({ sessionId, kind })
      .then(() => answer(''))
      .catch(() => answer(''))
    return
  }

  let hookInput
  try {
    hookInput = JSON.parse(body)
  } catch {
    answer(ASK)
  }

  post({
    sessionId,
    toolName: hookInput.tool_name,
    input: hookInput.tool_input,
  })
    .then((response) => response.json())
    .then((decision) => {
      const permissionDecision = decision && decision.permissionDecision
      if (permissionDecision !== 'allow' && permissionDecision !== 'deny') answer(ASK)

      const hookSpecificOutput = { hookEventName: 'PreToolUse', permissionDecision }
      if (decision.updatedInput !== undefined && decision.updatedInput !== null) {
        hookSpecificOutput.updatedInput = decision.updatedInput
      }
      if (typeof decision.reason === 'string' && decision.reason !== '') {
        hookSpecificOutput.permissionDecisionReason = decision.reason
      }
      answer(JSON.stringify({ hookSpecificOutput }))
    })
    .catch(() => answer(ASK))
})
`

export const HOOK_SCRIPT_NAME = 'pretooluse-hook.mjs'

/**
 * Writes the script and returns its path. Rewritten every start rather than
 * written once: a stale copy from an older version is a hook that answers the
 * wrong shape, and the failure would show up as permission prompts that never
 * reach the console.
 */
export function installHookScript(directory: string): string {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, HOOK_SCRIPT_NAME)
  writeFileSync(path, HOOK_SCRIPT, 'utf8')
  return path
}
