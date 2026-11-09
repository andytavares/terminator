import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { registerBugReportRoutes } from '../../src/server/routes/bug-report.routes'

// The phone sends a bug report over plain HTTP, like its terminal list: a second socket would show
// it twice under Connected now. The desktop's core answers through its declared channels (ADR 156).

const invokeChannel = vi.fn()

let app: FastifyInstance

beforeEach(async () => {
  app = Fastify({ logger: false })
  await registerBugReportRoutes(app, { invokeChannel })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe('GET /api/bug-report/status and /details', () => {
  it('answers whether the desktop’s gh can post', async () => {
    invokeChannel.mockResolvedValue({ ready: true, login: 'octocat' })

    const res = await app.inject({ method: 'GET', url: '/api/bug-report/status' })

    expect(res.json()).toEqual({ ready: true, login: 'octocat' })
    expect(invokeChannel).toHaveBeenCalledWith('bug-report:status', undefined)
  })

  it('answers the app details the report would carry', async () => {
    invokeChannel.mockResolvedValue({ details: 'Terminator 0.1.198' })

    const res = await app.inject({ method: 'GET', url: '/api/bug-report/details' })

    expect(res.json()).toEqual({ details: 'Terminator 0.1.198' })
    expect(invokeChannel).toHaveBeenCalledWith('bug-report:details', undefined)
  })
})

describe('POST /api/bug-report', () => {
  it('hands the report and its files to the desktop, and answers with the issue', async () => {
    invokeChannel.mockResolvedValue({ ok: true, number: 7, url: 'https://github.com/o/r/issues/7' })
    const report = { title: 't', uploads: [{ name: 'a.png', data: 'x'.repeat(2 * 1024 * 1024) }] }

    const res = await app.inject({ method: 'POST', url: '/api/bug-report', payload: report })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, number: 7, url: 'https://github.com/o/r/issues/7' })
    expect(invokeChannel).toHaveBeenCalledWith('bug-report:submit-uploaded', report)
  })
})
