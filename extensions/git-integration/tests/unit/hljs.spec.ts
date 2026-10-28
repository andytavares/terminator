import { describe, it, expect } from 'vitest'
import hljs from '../../src/utils/hljs'
import { extensionOf, extensionOfBlock, highlight } from '../../src/utils/syntax'

// Every extension the diff view and the merge blocks used to map by hand, run through the real
// highlight.js: an extension outside the bundled set fails here instead of rendering plain.
const FILES = [
  'a.ts',
  'a.tsx',
  'a.js',
  'a.jsx',
  'a.mjs',
  'a.cjs',
  'a.py',
  'a.rb',
  'a.go',
  'a.rs',
  'a.java',
  'a.c',
  'a.h',
  'a.cpp',
  'a.cc',
  'a.cxx',
  'a.hpp',
  'a.cs',
  'a.php',
  'a.swift',
  'a.kt',
  'a.kts',
  'a.sh',
  'a.bash',
  'a.zsh',
  'a.yaml',
  'a.yml',
  'a.json',
  'a.md',
  'a.html',
  'a.htm',
  'a.css',
  'a.scss',
  'a.less',
  'a.sql',
  'a.xml',
  'a.svg',
  'a.toml',
  'a.ini',
  'Dockerfile',
]

describe('highlight()', () => {
  it.each(FILES)('has a language for %s', (file) => {
    expect(hljs.getLanguage(extensionOf(file) ?? '')).toBeDefined()
  })

  it.each([
    ['a.ts', 'const x = 1', 'hljs-keyword'],
    ['a.py', 'def f(): pass', 'hljs-keyword'],
    ['a.json', '{"a": 1}', 'hljs-attr'],
    ['a.htm', '<a href="b">c</a>', 'hljs-tag'],
    ['Dockerfile', 'FROM node:22', 'hljs-keyword'],
  ])('colours %s', (file, code, token) => {
    expect(highlight(code, extensionOf(file))).toContain(token)
  })

  it('escapes the text when the extension has no language', () => {
    expect(highlight('<b>&', 'nosuchext')).toBe('&lt;b&gt;&amp;')
    expect(highlight('<b>', undefined)).toBe('&lt;b&gt;')
  })
})

describe('extensionOf()', () => {
  it('takes the last extension of the file name, lower-cased', () => {
    expect(extensionOf('src/App.TSX')).toBe('tsx')
    expect(extensionOf('v1.2/Dockerfile')).toBe('dockerfile')
  })

  it('reads the file of a merge block id', () => {
    expect(extensionOfBlock('src/foo.ts#3')).toBe('ts')
  })
})
