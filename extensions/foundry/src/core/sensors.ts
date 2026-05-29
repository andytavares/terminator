import { spawn } from 'node:child_process'
import type { Sensor, SensorResult } from '../types/foundry.types.js'

function lastNLines(text: string, n: number): string {
  const lines = text.split('\n').filter((l) => l.trim())
  return lines.slice(-n).join('\n')
}

export function runSensor(sensor: Sensor, workspaceRoot: string): Promise<SensorResult> {
  return new Promise((resolve) => {
    const start = Date.now()
    // Pass the command as a single string with shell:true so quoting and env vars work correctly
    const proc = spawn(sensor.command, [], { cwd: workspaceRoot, shell: true })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on('close', (exitCode: number | null) => {
      resolve({
        sensorName: sensor.name,
        command: sensor.command,
        exitCode: exitCode ?? 1,
        stdoutExcerpt: lastNLines(stdout, 20),
        stderrExcerpt: lastNLines(stderr, 20),
        pass: (exitCode ?? 1) === 0,
        durationMs: Date.now() - start,
        runAt: new Date().toISOString(),
      })
    })
  })
}

export async function runAllSensors(
  sensors: Sensor[],
  workspaceRoot: string
): Promise<SensorResult[]> {
  const results: SensorResult[] = []
  for (const sensor of sensors) {
    results.push(await runSensor(sensor, workspaceRoot))
  }
  return results
}
