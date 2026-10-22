import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { runPicturesStep } from '../../src/line/pictures.js'
import type { PicturesRecord } from '../../src/line/pictures.js'
import { makeTempDir } from '../../../../tests/support/temp-dir'

// The step's purpose is the images it leaves, so exit 0 alone is not a pass: a
// command that took no pictures measured nothing.

let featureDir: string
let recorded: PicturesRecord[]

beforeEach(() => {
  featureDir = makeTempDir('fdry-pictures-')
  recorded = []
})

afterEach(() => {
  fs.rmSync(featureDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
})

function leaveFiles(folder: string, names: string[]): void {
  for (const name of names) {
    fs.mkdirSync(path.dirname(path.join(folder, name)), { recursive: true })
    fs.writeFileSync(path.join(folder, name), 'x')
  }
}

function takePictures(
  command: (folder: string) => Promise<number | null>
): ReturnType<typeof runPicturesStep> {
  return runPicturesStep({
    featureDir,
    now: () => 1_700_000_000_000,
    run: command,
    record: async (entry) => {
      recorded.push(entry)
    },
  })
}

describe('running the pictures step', () => {
  describe('the folder and the images', folderAndImagesTests)
  describe('what is not a picture-taking pass', notAPassTests)
})

function folderAndImagesTests() {
  it('hands the command a fresh folder under the order records', async () => {
    let seen = ''
    await takePictures(async (folder) => {
      seen = folder
      return 0
    })
    expect(seen).toBe(path.join(featureDir, 'runs', 'pictures-1700000000000'))
    expect(fs.statSync(seen).isDirectory()).toBe(true)
  })

  it('records every image the command left, and only images, as screenshot evidence', async () => {
    const result = await takePictures(async (folder) => {
      leaveFiles(folder, ['home.png', 'detail.png', 'nested/dark.webp', 'notes.txt'])
      return 0
    })
    const folder = path.join(featureDir, 'runs', 'pictures-1700000000000')
    const images = [
      path.join(folder, 'detail.png'),
      path.join(folder, 'home.png'),
      path.join(folder, 'nested', 'dark.webp'),
    ]
    expect(result.exitCode).toBe(0)
    expect(result.taken).toEqual({ folder, images })
    expect(recorded).toHaveLength(1)
    expect(recorded[0].evidence).toEqual(images.map((p) => ({ kind: 'screenshot', path: p })))
  })
}

function notAPassTests() {
  it('is not measured when it exits 0 and leaves no images', async () => {
    const result = await takePictures(async () => 0)
    expect(result.exitCode).toBeNull()
    expect(result.taken?.images).toEqual([])
    expect(recorded[0]).toMatchObject({
      reason: 'the pictures command left no images',
      evidence: [],
    })
  })

  it('passes a failing exit code through and records nothing', async () => {
    const result = await takePictures(async (folder) => {
      fs.writeFileSync(path.join(folder, 'half.png'), 'x')
      return 3
    })
    expect(result).toEqual({ exitCode: 3, taken: null })
    expect(recorded).toEqual([])
  })

  it('stays not measured when the command did not run', async () => {
    expect(await takePictures(async () => null)).toEqual({ exitCode: null, taken: null })
    expect(recorded).toEqual([])
  })
}
