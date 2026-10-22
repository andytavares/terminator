import * as fs from 'node:fs'
import * as path from 'node:path'

import type { PicturesTaken } from '../verify/ladder.js'
import type { Evidence } from '../verify/verdict.js'

// The pictures step: a command that leaves images of the running application in a folder
// the line chose. Its exit status says the command ran; the images say it did its job.

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])

export const NO_IMAGES_REASON = 'the pictures command left no images'

/** What the order's ledger is told, as a `verify.pictures` entry. */
export interface PicturesRecord {
  readonly reason: string
  readonly evidence: readonly Evidence[]
}

interface PicturesRun {
  readonly featureDir: string
  readonly now: () => number
  /** Runs the command with the folder it should leave images in. */
  readonly run: (folder: string) => Promise<number | null>
  readonly record: (entry: PicturesRecord) => Promise<void>
}

/** The exit status the ladder sees, and what was taken when the command ran to the end. */
interface PicturesResult {
  readonly exitCode: number | null
  readonly taken: PicturesTaken | null
}

async function imagesIn(folder: string): Promise<string[]> {
  const entries = await fs.promises.readdir(folder, { recursive: true, withFileTypes: true })
  return entries
    .filter(
      (entry) => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    )
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort()
}

export async function runPicturesStep(pictures: PicturesRun): Promise<PicturesResult> {
  const folder = path.join(pictures.featureDir, 'runs', `pictures-${pictures.now()}`)
  await fs.promises.mkdir(folder, { recursive: true })
  const exitCode = await pictures.run(folder)
  if (exitCode !== 0) return { exitCode, taken: null }

  const images = await imagesIn(folder)
  const evidence = images.map((image): Evidence => ({ kind: 'screenshot', path: image }))
  await pictures.record({
    reason: images.length === 0 ? NO_IMAGES_REASON : `${images.length} images left in ${folder}`,
    evidence,
  })
  // Exit 0 with nothing to show measured nothing: null, never a pass.
  return { exitCode: images.length === 0 ? null : 0, taken: { folder, images } }
}
