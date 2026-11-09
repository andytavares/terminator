import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

// The files of bug reports. A report attaches only files this module handed out: a window capture
// it saved, or a file the user chose in the file picker. A path from anywhere else is refused, so
// a renderer cannot attach an arbitrary file on disk to a public issue.

export interface ReportFile {
  path: string
  name: string
  bytes: number
}

/** A timestamp usable in a file name. */
function stamp(at: Date): string {
  return at.toISOString().replace(/[:.]/g, '-')
}

async function describeFile(path: string): Promise<ReportFile> {
  return { path, name: basename(path), bytes: (await stat(path)).size }
}

async function saveCapture(reportsDir: string, png: Buffer, at: Date): Promise<ReportFile> {
  const folder = join(reportsDir, 'captures')
  await mkdir(folder, { recursive: true })
  const path = join(folder, `window-${stamp(at)}.png`)
  await writeFile(path, png)
  return describeFile(path)
}

/** Writes a file the phone sent to `<reports>/uploads/<timestamp>/`, under its own name only: a
 * name with folders in it cannot write anywhere else. */
async function saveUpload(
  reportsDir: string,
  { name, data }: { name: string; data: Buffer },
  at: Date
) {
  const folder = join(reportsDir, 'uploads', stamp(at))
  await mkdir(folder, { recursive: true })
  const path = join(folder, basename(name))
  await writeFile(path, data)
  return describeFile(path)
}

/** Copies the files into one new folder, `<reports>/<timestamp>/`, and answers their new paths. */
async function gather(reportsDir: string, paths: readonly string[], at: Date): Promise<string[]> {
  const folder = join(reportsDir, stamp(at))
  await mkdir(folder, { recursive: true })
  return Promise.all(
    paths.map(async (path) => {
      const copy = join(folder, basename(path))
      await copyFile(path, copy)
      return copy
    })
  )
}

export function createReportFiles(reportsDir: string) {
  const granted = new Set<string>()
  const grant = (file: ReportFile): ReportFile => (granted.add(file.path), file)
  return {
    /** Writes a PNG of the window to `<reports>/captures/`. */
    saveCapture: async (png: Buffer, at: Date) => grant(await saveCapture(reportsDir, png, at)),
    /** A file the phone sent with its report. */
    saveUpload: async (name: string, data: Buffer, at: Date) =>
      grant(await saveUpload(reportsDir, { name, data }, at)),
    /** Files the user chose in the picker. */
    add: async (paths: readonly string[]) =>
      (await Promise.all(paths.map(describeFile))).map(grant),
    isGranted: (path: string) => granted.has(path),
    gather: (paths: readonly string[], at: Date) => gather(reportsDir, paths, at),
  }
}

export type ReportFiles = ReturnType<typeof createReportFiles>
