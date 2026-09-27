import { describe, it, expect } from 'vitest'
import hljs from '../../src/utils/hljs'
import { detectLanguage } from '../../src/components/FileDiffView'
import { langFromBlockId } from '../../src/utils/syntax'

// Every extension the diff view and the review blocks recognise, so a mapping
// to a language outside the bundled set fails here instead of rendering plain.
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

describe('the bundled highlight.js languages', () => {
  it('cover every language the diff view maps a file to', () => {
    const unknown = FILES.map(detectLanguage).filter(
      (lang): lang is string => lang !== undefined && hljs.getLanguage(lang) === undefined
    )
    expect(unknown).toEqual([])
  })

  it('cover every language a review block maps a file to', () => {
    const mapped = FILES.map((file) => langFromBlockId(`${file}#0`))
    expect(mapped.filter((lang) => lang !== undefined).length).toBeGreaterThan(20)
    expect(mapped.filter((lang) => lang !== undefined && !hljs.getLanguage(lang))).toEqual([])
  })

  it('highlights a Dockerfile, which the common set leaves out', () => {
    expect(hljs.highlight('FROM node:22\nRUN npm ci', { language: 'dockerfile' }).value).toContain(
      'hljs-keyword'
    )
  })
})
