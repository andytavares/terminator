import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, it, expect } from 'vitest'

import { publishedArtifacts, readPublishedArtifacts } from '../../src/runtime/artifact-publishes.js'
import { temporaryDirectory } from '../helpers/foundry-host.js'

const entry = (role: string, content: unknown[]): string =>
  JSON.stringify({ type: role, message: { role, content } })

const call = (id: string, name: string, filePath: string): string =>
  entry('assistant', [{ type: 'tool_use', id, name, input: { file_path: filePath } }])

const result = (id: string, content: unknown): string =>
  entry('user', [{ type: 'tool_result', tool_use_id: id, content }])

const URL_ONE = 'https://claude.ai/artifact/YJeSCmFWK1GJC8X9ZXUpVf'
const URL_TWO = 'https://claude.ai/artifact/AbCdEfGh1234567890'
const REPORT = '/private/tmp/work/foundry-research-artifacts.html'

function publishedArtifactsTests() {
  it('reads a publish whose result is a string', () => {
    const text = [
      call('t1', 'Artifact', REPORT),
      result('t1', `Published ${REPORT} at ${URL_ONE} (Version 1, version id 17-9d45)`),
    ].join('\n')
    expect(publishedArtifacts(text)).toEqual([{ path: REPORT, url: URL_ONE }])
  })

  it('reads a publish whose result is an array of text parts, and every publish in order', () => {
    const text = [
      call('t1', 'Artifact', REPORT),
      result('t1', [{ type: 'text', text: `Published ${REPORT} at ${URL_ONE} (Version 1)` }]),
      call('t2', 'Artifact', '/tmp/second.html'),
      result('t2', [
        { type: 'text', text: `Published /tmp/second.html at ${URL_TWO} (Version 2)` },
      ]),
    ].join('\n')
    expect(publishedArtifacts(text).map((found) => found.url)).toEqual([URL_ONE, URL_TWO])
  })
}

function ignoredTests() {
  it('ignores the result of a tool that is not Artifact', () => {
    const text = [
      call('t1', 'Bash', REPORT),
      result('t1', `Published ${REPORT} at ${URL_ONE} (Version 1)`),
    ].join('\n')
    expect(publishedArtifacts(text)).toEqual([])
  })

  it('ignores a publish that failed', () => {
    const text = [
      call('t1', 'Artifact', REPORT),
      result('t1', `Error: could not publish ${REPORT} at ${URL_ONE}`),
    ].join('\n')
    expect(publishedArtifacts(text)).toEqual([])
  })

  it('skips lines that are not JSON', () => {
    const text = [
      'not json',
      call('t1', 'Artifact', REPORT),
      '{"broken":',
      result('t1', `Published ${REPORT} at ${URL_ONE} (Version 1)`),
    ].join('\n')
    expect(publishedArtifacts(text)).toHaveLength(1)
  })
}

describe('the artifacts a session published', publishedArtifactsTests)
describe('what is not a publish', ignoredTests)

describe('a transcript file', () => {
  it('reads a transcript file, and a missing one published nothing', () => {
    const directory = temporaryDirectory('fdry-publishes')
    const file = path.join(directory, 'session.jsonl')
    fs.writeFileSync(
      file,
      [
        call('t1', 'Artifact', REPORT),
        result('t1', `Published ${REPORT} at ${URL_ONE} (Version 1)`),
      ].join('\n')
    )
    expect(readPublishedArtifacts(file)).toEqual([{ path: REPORT, url: URL_ONE }])
    expect(readPublishedArtifacts(path.join(directory, 'missing.jsonl'))).toEqual([])
  })
})
