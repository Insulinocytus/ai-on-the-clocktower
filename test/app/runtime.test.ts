import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setTimeout as delay } from 'node:timers/promises'
import type { CreateGameBody, GameDetail, Preset, Provider, PresetTestResult, GameSummary } from '../../shared/api'
import { DISCRETION_IDS, type DiscretionSource, type GameEvent, type DiscretionValue } from '../../shared/rules/types'
import { project, foldPublic } from '../../shared/rules'
import { renderEvent } from '../../shared/templates'
import type { ProviderRequest } from './harness'
import { buildApp, defaultReply, Harness, tool, type FakeReply } from './harness'

const app = new Harness()
let provider: Provider
let preset: Preset
const setup: DiscretionValue = { roles: ['slayer', 'soldier', 'mayor', 'poisoner', 'imp'] }
function gameBody(source: DiscretionSource = 'manual'): CreateGameBody {
  return { seatCount: 5, seats: Array.from({ length: 5 }, () => preset.id), storytellerPresetId: null,
    sources: Object.fromEntries(DISCRETION_IDS.map(id => [id, id === 'D1' || id === 'seating' ? source : 'random'])) as CreateGameBody['sources'], maxSpeeches: 1, whisperRooms: 0, language: 'en' }
}
async function create(body = gameBody()): Promise<string> {
  const result = await app.api<{ id: string }>('/games', 'POST', body)
  expect(result.status).toBe(200)
  return result.data.id
}
async function pending(id: string): Promise<number> {
  const detail = await app.until(() => app.api<GameDetail>(`/games/${id}`), r => r.data.summary.status === 'awaiting_manual')
  return detail.data.summary.pending!.seq
}
async function begin(): Promise<string> {
  const id = await create()
  expect((await app.api(`/games/${id}/discretions/${await pending(id)}`, 'POST', { value: setup })).status).toBe(200)
  return id
}
async function finished(id: string): Promise<GameEvent[]> {
  return app.until(() => app.log(id), log => log.some(e => e.type === 'game.ended' || e.type === 'game.aborted'))
}
const invalid: FakeReply = (_body, response) => { response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: 'not a tool' } }] })) }
const failure: FakeReply = (_body, response) => { response.writeHead(503).end('unavailable') }
const hang: FakeReply = () => {}

describe('production application HTTP seam', () => {
  beforeAll(async () => {
    await buildApp()
    await app.initialize()
    provider = (await app.api<Provider>('/providers', 'POST', { name: 'Local fake', baseUrl: app.fakeUrl, apiKeyEnv: 'APP_TEST_KEY', maxConcurrency: 2 })).data
    preset = (await app.api<Preset>('/presets', 'POST', { name: 'Fake contestant', providerId: provider.id, model: 'fake', forceToolChoice: true, extraBody: { max_tokens: 128, reasoning: { enabled: true } } })).data
  }, 180_000)
  beforeEach(async () => {
    const games = await app.api<GameSummary[]>('/games')
    for (const game of games.data) if (game.status === 'running' || game.status === 'awaiting_manual') await app.api(`/games/${game.id}/abort`, 'POST')
    await app.until(async () => app.active, active => active === 0)
    app.requests = []; app.replies = []; app.peak = 0; app.nominationCalls = 0; app.reply = defaultReply
    await app.api(`/providers/${provider.id}`, 'PUT', { ...provider, maxConcurrency: 2 })
  })
  afterAll(async () => { if (app.dataDir) await app.dispose() })

  it('validates game configuration and lists missing credential environment variables without exposing keys', async () => {
    const missing = (await app.api<Provider>('/providers', 'POST', { name: 'Unset', baseUrl: app.fakeUrl, apiKeyEnv: 'CLOCKTOWER_DEFINITELY_UNSET' })).data
    expect(missing.keySet).toBe(false)
    const unset = (await app.api<Preset>('/presets', 'POST', { name: 'Unset', providerId: missing.id, model: 'fake', forceToolChoice: false, extraBody: {} })).data
    const result = await app.api<{ error: string; missing: string[] }>('/games', 'POST', { ...gameBody(), seats: Array.from({ length: 5 }, () => unset.id) })
    expect(result).toMatchObject({ status: 400, data: { error: 'missing_env', missing: ['CLOCKTOWER_DEFINITELY_UNSET'] } })
    for (const input of [{ seatCount: 4 }, { maxSpeeches: 0 }, { whisperRooms: -1 }, { seats: ['missing'] }, { storytellerPresetId: preset.id }]) {
      expect((await app.api('/games', 'POST', { ...gameBody(), ...input })).status).toBe(400)
    }
    const saved = await app.api<Provider[]>('/providers')
    expect(saved.data.find(p => p.id === provider.id)).toMatchObject({ keySet: true, timeoutSec: 300 })
    expect(JSON.stringify(saved.data)).not.toContain('test-secret')
  })

  it('accepts only legal manual decisions, first submission wins, and snapshot survives preset edits and deletion', async () => {
    const copy = (await app.api<Preset>('/presets', 'POST', { ...preset, name: 'Original snapshot' })).data
    const id = await create({ ...gameBody(), seats: Array.from({ length: 5 }, () => copy.id) })
    const seq = await pending(id)
    expect((await app.api(`/games/${id}/discretions/${seq}`, 'POST', { value: { roles: ['imp'] } })).status).toBe(400)
    app.replies = [hang]
    const results = await Promise.all([app.api(`/games/${id}/discretions/${seq}`, 'POST', { value: setup }), app.api<{ value: DiscretionValue }>(`/games/${id}/discretions/${seq}`, 'POST', { value: setup })])
    expect(results.map(r => r.status).sort()).toEqual([200, 409])
    expect(results.find(r => r.status === 409)?.data).toMatchObject({ error: 'conflict', value: setup })
    await app.api(`/presets/${copy.id}`, 'PUT', { ...copy, name: 'Edited' })
    await app.api(`/presets/${copy.id}`, 'DELETE')
    const detail = (await app.api<GameDetail>(`/games/${id}`)).data
    expect(detail.config.seats[0]?.name).toBe('Original snapshot')
    expect((await app.log(id)).filter(e => e.type === 'discretion.resolved' && e.requestSeq === seq)).toHaveLength(1)
  })

  it('shares a three-attempt limit across invalid outputs and transport errors and keeps raw responses', async () => {
    app.replies = [invalid, failure, invalid]
    const id = await begin()
    const log = await finished(id)
    const decisions = log.filter(e => e.type === 'contestant.decision')
    expect(decisions.map(e => e.attempt)).toEqual([1, 2, 3])
    expect(decisions.map(e => e.outcome.ok ? 'ok' : e.outcome.errorKind)).toEqual(['invalid', 'http', 'invalid'])
    expect(decisions[0]?.response).toMatchObject({ choices: [{ message: { content: 'not a tool' } }] })
    expect(app.requests[1]).toEqual(app.requests[2])
    expect(app.requests[1]?.messages).not.toEqual(app.requests[0]?.messages)
    expect(app.requests[1]?.tools).toEqual(app.requests[0]?.tools)
    expect(log.at(-1)).toMatchObject({ type: 'game.aborted', reason: 'model_failure', seat: 4 })
  })

  it('retries invalid output immediately with a correction and applies valid memos', async () => {
    app.replies = [invalid, (_body, response) => { response.end(JSON.stringify(tool('night_choice', { targets: [1], memo: 'remember this' }))) }]
    const id = await begin()
    const log = await finished(id)
    expect(log.some(e => e.type === 'seat.memo.updated' && e.seat === 4 && e.text === 'remember this')).toBe(true)
    expect(app.requests[1]?.messages[1]?.content.length).toBeGreaterThan(app.requests[0]!.messages[1]!.content.length)
    expect(log.some(e => e.type === 'game.ended')).toBe(true)
  })

  it('respects Retry-After and releases a provider slot while backing off', async () => {
    await app.api(`/providers/${provider.id}`, 'PUT', { ...provider, maxConcurrency: 1 })
    const times: number[] = []
    app.replies = [(_body, response) => { times.push(performance.now()); response.writeHead(429, { 'Retry-After': '0.12' }).end('slow down') }, (body, response) => { times.push(performance.now()); defaultReply(body, response) }, invalid, invalid]
    const first = await begin()
    const second = await begin()
    await app.until(async () => app.requests.length, count => count >= 2)
    expect(times[1]! - times[0]!).toBeLessThan(120)
    await app.api(`/games/${second}/abort`, 'POST')
    await finished(first)
    const log = await app.log(first)
    expect(log.find(e => e.type === 'contestant.decision')).toMatchObject({ outcome: { ok: false, status: 429 } })
    expect(app.peak).toBe(1)
  })

  it('retries 5xx failures with identical requests and classifies timeouts', async () => {
    app.replies = [failure, failure, failure]
    const http = await begin()
    await finished(http)
    expect(app.requests).toHaveLength(3)
    expect(app.requests[0]).toEqual(app.requests[1])
    expect(app.requests[1]).toEqual(app.requests[2])
    app.requests = []; app.replies = [hang, hang, hang]
    const timeout = await begin()
    const log = await finished(timeout)
    expect(log.filter(e => e.type === 'contestant.decision').map(e => e.outcome.ok ? '' : e.outcome.errorKind)).toEqual(['timeout', 'timeout', 'timeout'])
  })

  it('enforces FIFO provider concurrency across games without charging queue time to timeout', async () => {
    await app.api(`/providers/${provider.id}`, 'PUT', { ...provider, maxConcurrency: 1 })
    app.replies = [async (body, response) => { await delay(100); defaultReply(body, response) }, async (body, response) => { await delay(100); defaultReply(body, response) }, async (body, response) => { await delay(100); defaultReply(body, response) }]
    const ids = [await begin(), await begin(), await begin()]
    await app.until(async () => app.requests.length, count => count >= 3)
    for (const id of ids) await app.api(`/games/${id}/abort`, 'POST')
    expect(app.peak).toBe(1)
    for (const id of ids.slice(0, 2)) expect((await app.log(id)).find(e => e.type === 'contestant.decision')).toMatchObject({ outcome: { ok: true } })
  })

  it('cancels in-flight and queued calls without writing cancelled decisions', async () => {
    await app.api(`/providers/${provider.id}`, 'PUT', { ...provider, maxConcurrency: 1 })
    app.replies = [hang]
    const first = await begin()
    const second = await begin()
    await app.until(async () => app.requests.length, count => count === 1)
    expect((await app.api(`/games/${second}/abort`, 'POST')).status).toBe(200)
    expect((await app.api(`/games/${first}/abort`, 'POST')).status).toBe(200)
    await delay(180)
    expect(app.requests).toHaveLength(1)
    for (const id of [first, second]) {
      const log = await app.log(id)
      expect(log.filter(e => e.type === 'contestant.decision')).toHaveLength(0)
      expect(log.at(-1)).toMatchObject({ type: 'game.aborted', reason: 'human' })
      expect((await app.api(`/games/${id}/abort`, 'POST')).status).toBe(409)
    }
  })

  it('aborts while waiting for manual discretion and rejects stale submission', async () => {
    const id = await create()
    const seq = await pending(id)
    await app.api(`/games/${id}/abort`, 'POST')
    expect((await app.api(`/games/${id}/discretions/${seq}`, 'POST', { value: setup })).status).toBe(409)
    expect(app.requests).toHaveLength(0)
  })

  it('marks unfinished logs aborted after process restart', async () => {
    const id = await create()
    await pending(id)
    await app.stop()
    await app.start()
    expect((await app.log(id)).at(-1)).toMatchObject({ type: 'game.aborted', reason: 'restart' })
    expect((await app.api<GameDetail>(`/games/${id}`)).data.summary.status).toBe('aborted')
  })

  it('resumes SSE with after and Last-Event-ID without missing or repeating persisted events', async () => {
    const id = await create()
    const seq = await pending(id)
    const abort = new AbortController()
    const response = await fetch(`${app.url}/api/games/${id}/events?after=0`, { headers: { Accept: 'text/event-stream', 'Last-Event-ID': '1' }, signal: abort.signal })
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const reader = response.body!.getReader()
    let received = ''
    const read = async () => { const chunk = await reader.read(); received += new TextDecoder().decode(chunk.value); return received }
    await app.until(read, text => text.includes(`id: ${seq}\n`))
    await app.api(`/games/${id}/abort`, 'POST')
    await app.until(read, text => text.includes('game.aborted'))
    abort.abort()
    const live = received.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)) as GameEvent)
    const backlog = (await app.api<GameEvent[]>(`/games/${id}/events?after=1`)).data
    expect(live.map(e => e.seq)).toEqual(backlog.map(e => e.seq))
    expect(new Set(live.map(e => e.seq)).size).toBe(live.length)
    const publicLog = (await app.api<GameEvent[]>(`/games/${id}/events?observer=public`)).data
    expect(publicLog).toEqual([])
  })

  it('tests presets with six fixed tools, vendor parameters, and no persisted decision', async () => {
    const result = await app.api<PresetTestResult>(`/presets/${preset.id}/test`, 'POST', { language: 'en' })
    expect(result.data).toMatchObject({ ok: true, toolCall: { name: 'speak' }, error: null })
    expect(app.requests[0]?.tools.map(t => t.function.name)).toEqual(['speak', 'propose_whisper', 'rank_whispers', 'nominate', 'vote', 'night_choice'])
    expect(app.requests[0]).toMatchObject({ max_tokens: 128, reasoning: { enabled: true } })
    expect(app.requests[0]).not.toHaveProperty('temperature')
    expect(app.requests[0]?.messages.map(m => m.role)).toEqual(['system', 'user'])
    app.replies = [invalid]
    expect((await app.api<PresetTestResult>(`/presets/${preset.id}/test`, 'POST', {})).data.ok).toBe(false)
  })

  it('preserves each seat prefix during a day, then truncates old speeches only on a day change', async () => {
    const presets: Preset[] = []
    for (let seat = 1; seat <= 5; seat++) presets.push((await app.api<Preset>('/presets', 'POST', { ...preset, name: `Seat ${seat}`, model: `seat-${seat}` })).data)
    const id = await create({ ...gameBody(), seats: presets.map(p => p.id), maxSpeeches: 2 })
    const captured: { body: ProviderRequest; log: GameEvent[]; day: number; seat: number }[] = []
    app.reply = async (body, response) => {
      const log = await app.log(id)
      const day = foldPublic(log).day
      const seat = Number(body.model.slice(5))
      captured.push({ body, log, day, seat })
      const expected = body.tool_choice!.function.name
      if (day >= 3 && seat === 1 && expected === 'speak') return
      const args = expected === 'night_choice' ? { targets: [seat === 5 ? 2 : 1] }
        : expected === 'nominate' ? { nominee: null }
          : { speech: `Unique speech day ${day} seat ${seat}`, slayer_target: null }
      response.end(JSON.stringify(tool(expected, args)))
    }
    await app.api(`/games/${id}/discretions/${await pending(id)}`, 'POST', { value: setup })
    await app.until(async () => captured, calls => calls.some(c => c.day === 3 && c.seat === 1 && c.body.tool_choice?.function.name === 'speak'))
    await app.api(`/games/${id}/abort`, 'POST')
    const dayOne = captured.filter(c => c.day === 1 && c.seat === 1 && c.body.tool_choice?.function.name === 'speak')
    expect(dayOne.length).toBeGreaterThan(1)
    const first = dayOne[0]!
    const second = dayOne[1]!
    const rendered = project(first.log, { kind: 'seat', seat: 1 }).flatMap(e => { const line = renderEvent(e, { lang: 'en', person: 'seat', self: 1 }); return line === null || e.type === 'seat.memo.updated' ? [] : [line] })
    const lastLine = rendered.at(-1)!
    const user = first.body.messages[1]!.content
    const prefix = user.slice(0, user.indexOf(lastLine) + lastLine.length)
    expect(second.body.messages[1]!.content.startsWith(prefix)).toBe(true)
    expect(second.body.messages[0]).toEqual(first.body.messages[0])
    expect(second.body.tools).toEqual(first.body.tools)
    const dayTwo = captured.find(c => c.day === 2 && c.seat === 1 && c.body.tool_choice?.function.name === 'speak')!
    const dayThree = captured.find(c => c.day === 3 && c.seat === 1 && c.body.tool_choice?.function.name === 'speak')!
    expect(dayTwo.body.messages[1]!.content).toContain('Unique speech day 1 seat')
    expect(dayThree.body.messages[1]!.content).not.toContain('Unique speech day 1 seat')
    expect(dayThree.body.messages[1]!.content).toContain('Unique speech day 2 seat')
  })

  it('skips calls for used dead votes while retaining the deterministic vote event', async () => {
    const id = await create({ ...gameBody(), seatCount: 7, seats: Array.from({ length: 7 }, () => preset.id) })
    app.reply = async (body, response) => {
      const log = await app.log(id)
      const state = foldPublic(log)
      const expected = body.tool_choice!.function.name
      const nominee = state.day === 1 ? 1 : state.nomineesToday.includes(3) ? 7 : 3
      const args = expected === 'night_choice' ? { targets: [2] }
        : expected === 'nominate' ? { nominee: state.nomineesToday.includes(nominee) ? null : nominee }
          : expected === 'vote' ? { raise_hand: true }
            : { speech: 'A test statement.', slayer_target: null }
      response.end(JSON.stringify(tool(expected, args)))
    }
    await app.api(`/games/${id}/discretions/${await pending(id)}`, 'POST', { value: { roles: ['slayer', 'mayor', 'chef', 'empath', 'soldier', 'poisoner', 'imp'] } })
    const log = await app.until(() => app.log(id), events => events.some(e => e.type === 'vote' && e.seat === 1 && e.decisionSeq === null))
    await app.api(`/games/${id}/abort`, 'POST')
    const used = log.find(e => e.type === 'vote' && e.seat === 1 && e.tokenUsed)
    const automatic = log.find(e => e.type === 'vote' && e.seat === 1 && e.decisionSeq === null)
    expect(used).toBeDefined()
    expect(automatic).toMatchObject({ raised: false, tokenUsed: false })
    expect(automatic!.seq).toBeGreaterThan(used!.seq)
  })

  it('runs a full game through game.ended and returns a replayable completed summary', async () => {
    const id = await begin()
    const log = await finished(id)
    expect(log[0]).toMatchObject({ type: 'game.created' })
    expect(log.at(-1)).toMatchObject({ type: 'game.ended', winner: 'good', reason: 'demon_dead' })
    expect(log.map(e => e.seq)).toEqual(Array.from({ length: log.length }, (_, index) => index + 1))
    const detail = (await app.api<GameDetail>(`/games/${id}`)).data
    expect(detail.summary).toMatchObject({ status: 'ended', replayable: true, winner: 'good' })
    expect(app.requests.filter(r => r.tool_choice?.function.name === 'decide')).toHaveLength(0)
  })
})
