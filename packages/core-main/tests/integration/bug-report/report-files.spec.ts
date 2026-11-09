import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { makeTempDir } from '../../../../test-support/src/temp-dir'
import { createReportFiles } from '../../../src/bug-report/report-files'

const AT = new Date('2026-11-09T14:02:03.004Z')

function pickedFile(name: string, content: string): string {
  const file = join(makeTempDir('picked-'), name)
  writeFileSync(file, content)
  return file
}

describe('report files', () => {
  it('saves a window capture in the reports folder and hands it out', async () => {
    const reportsDir = makeTempDir('reports-')
    const files = createReportFiles(reportsDir)

    const capture = await files.saveCapture(Buffer.from('png bytes'), AT)

    expect(capture).toEqual({
      path: join(reportsDir, 'captures', 'window-2026-11-09T14-02-03-004Z.png'),
      name: 'window-2026-11-09T14-02-03-004Z.png',
      bytes: 9,
    })
    expect(readFileSync(capture.path, 'utf8')).toBe('png bytes')
    expect(files.isGranted(capture.path)).toBe(true)
  })

  it('hands out a picked file with its size', async () => {
    const files = createReportFiles(makeTempDir('reports-'))
    const picked = pickedFile('repro.mov', '12345')

    expect(await files.add([picked])).toEqual([{ path: picked, name: 'repro.mov', bytes: 5 }])
    expect(files.isGranted(picked)).toBe(true)
  })
})

describe('report files, handing out and gathering', () => {
  it('does not hand out a path it was never given', () => {
    const files = createReportFiles(makeTempDir('reports-'))

    expect(files.isGranted('/etc/passwd')).toBe(false)
  })

  it('gathers a report’s files into one new folder, for dragging into a browser', async () => {
    const reportsDir = makeTempDir('reports-')
    const files = createReportFiles(reportsDir)
    const capture = await files.saveCapture(Buffer.from('png'), AT)
    const picked = pickedFile('repro.mov', 'video')

    const gathered = await files.gather([capture.path, picked], AT)

    expect(gathered.map((file) => basename(file))).toEqual([capture.name, 'repro.mov'])
    expect(new Set(gathered.map((file) => dirname(file)))).toEqual(
      new Set([join(reportsDir, '2026-11-09T14-02-03-004Z')])
    )
    expect(readFileSync(gathered[1], 'utf8')).toBe('video')
  })
})

describe('report files, uploaded from the phone', () => {
  it('saves an upload under its own name only, and hands it out', async () => {
    const reportsDir = makeTempDir('reports-')
    const files = createReportFiles(reportsDir)

    const upload = await files.saveUpload('../../etc/IMG_2210.MOV', Buffer.from('video'), AT)

    expect(upload).toEqual({
      path: join(reportsDir, 'uploads', '2026-11-09T14-02-03-004Z', 'IMG_2210.MOV'),
      name: 'IMG_2210.MOV',
      bytes: 5,
    })
    expect(files.isGranted(upload.path)).toBe(true)
  })
})
