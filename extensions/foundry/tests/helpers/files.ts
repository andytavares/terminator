import * as fs from 'node:fs'
import * as path from 'node:path'

/** Writes `content` to `file`, creating its directory; anything but a string is written as JSON. */
export function writeFileWithDirs(file: string, content: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content))
}
