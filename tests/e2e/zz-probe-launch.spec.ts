// [DEBUG-f0c5] throwaway probe: does a launch ever hang waiting on `focused`?
import { test } from '@playwright/test'
import { launchApp, closeApp } from './helpers'

test.setTimeout(30 * 60_000)
test('[DEBUG-f0c5] launch loop', async () => {
  const runs = Number(process.env.PROBE_RUNS ?? 30)
  const failures: string[] = []
  for (let i = 0; i < runs; i++) {
    const started = Date.now()
    try {
      const handle = await launchApp()
      await closeApp(handle)
      console.log(`[DEBUG-f0c5] launch ${i} ok ${Date.now() - started}ms`)
    } catch (error) {
      failures.push(`${i}: ${String(error).split('\n')[0]}`)
      console.log(`[DEBUG-f0c5] launch ${i} FAILED ${String(error).split('\n')[0]}`)
    }
  }
  console.log(`[DEBUG-f0c5] ${failures.length}/${runs} failed\n${failures.join('\n')}`)
})
