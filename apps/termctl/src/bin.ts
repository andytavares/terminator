import { homedir } from 'node:os'
import { createInterface } from 'node:readline/promises'
import { main } from './cli.js'
import { connectToTerminator } from './connect.js'

async function ask(question: string): Promise<string> {
  const prompt = createInterface({ input: process.stdin, output: process.stderr })
  try {
    return await prompt.question(question)
  } finally {
    prompt.close()
  }
}

const clock = {
  now: Date.now,
  every: (ms: number, run: () => void) => {
    const timer = setInterval(run, ms)
    return () => clearInterval(timer)
  },
}

process.exitCode = await main(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
  ask: process.stdin.isTTY ? ask : null,
  terminal:
    process.stdin.isTTY && process.stdout.isTTY
      ? { stdin: process.stdin, stdout: process.stdout, cwd: process.cwd(), home: homedir(), clock }
      : null,
  connect: connectToTerminator,
})
