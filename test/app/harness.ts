import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { AddressInfo } from 'node:net'
import type { GameEvent } from '../../shared/rules/types'

export interface ProviderRequest { model: string; messages: { role: string; content: string }[]; tools: { function: { name: string } }[]; tool_choice?: { function: { name: string } }; [key: string]: unknown }
export type FakeReply = (body: ProviderRequest, response: ServerResponse) => void | Promise<void>
export function tool(name: string, args: Record<string, unknown>): unknown {
  return { id: 'fake', choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'call', type: 'function', function: { name, arguments: JSON.stringify({ reasoning: 'test', ...args }) } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }
}
export function defaultReply(body: ProviderRequest, response: ServerResponse): void {
  const expected = body.tool_choice?.function.name ?? 'speak'
  const args: Record<string, Record<string, unknown>> = {
    speak: { speech: 'A test statement.', slayer_target: null }, night_choice: { targets: [1] }, nominate: { nominee: 5 },
    vote: { raise_hand: true }, propose_whisper: { members: null }, rank_whispers: { ranking: [] },
    decide: { roles: ['slayer', 'soldier', 'mayor', 'poisoner', 'imp'] },
  }
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(tool(expected, args[expected]!)))
}
export class Harness {
  url = ''
  fakeUrl = ''
  dataDir = ''
  process: ChildProcess | undefined
  requests: ProviderRequest[] = []
  replies: FakeReply[] = []
  reply: FakeReply = defaultReply
  active = 0
  peak = 0
  closed = 0
  output = ''
  nominationCalls = 0
  fake = createServer((request, response) => { void this.handle(request, response) })
  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let content = ''
    for await (const chunk of request) content += String(chunk)
    const body = JSON.parse(content) as ProviderRequest
    this.requests.push(body)
    this.active++
    this.peak = Math.max(this.peak, this.active)
    response.once('close', () => { this.active--; this.closed++ })
    try {
      const reply = this.replies.shift()
      if (reply) await reply(body, response)
      else if (this.reply === defaultReply && body.tool_choice?.function.name === 'nominate' && ++this.nominationCalls > 5) {
        response.end(JSON.stringify(tool('nominate', { nominee: null })))
      } else await this.reply(body, response)
    }
    catch { response.destroy() }
  }
  async initialize(): Promise<void> {
    this.dataDir = await mkdtemp(join(tmpdir(), 'clocktower-app-'))
    const ready = Promise.withResolvers<void>()
    this.fake.listen(0, '127.0.0.1', ready.resolve)
    await ready.promise
    this.fakeUrl = `http://127.0.0.1:${(this.fake.address() as AddressInfo).port}/v1`
    await this.start()
  }
  async start(): Promise<void> {
    this.output = ''
    const ready = Promise.withResolvers<string>()
    const portProbe = createServer()
    const bound = Promise.withResolvers<void>()
    portProbe.listen(0, '127.0.0.1', bound.resolve)
    await bound.promise
    const port = (portProbe.address() as AddressInfo).port
    const released = Promise.withResolvers<void>()
    portProbe.close(() => released.resolve())
    await released.promise
    const child = spawn(process.execPath, ['server/start.mjs'], {
      env: { ...process.env, DATA_DIR: this.dataDir, NITRO_PORT: String(port), HOST: undefined, NITRO_HOST: undefined, APP_TEST_KEY: 'test-secret', LLM_BACKOFF_BASE_MS: '10', LLM_TIMEOUT_MS: '150', NITRO_SHUTDOWN_TIMEOUT: '100', NITRO_SHUTDOWN_FORCE: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.process = child
    child.stdout?.on('data', chunk => {
      this.output += String(chunk)
      const match = this.output.match(/Listening on (http:\/\/127\.0\.0\.1:\d+)/)
      if (match) ready.resolve(match[1]!)
    })
    child.stderr?.on('data', chunk => { this.output += String(chunk) })
    child.once('exit', code => { ready.reject(new Error(`Server exited ${code}: ${this.output}`)) })
    this.url = await Promise.race([ready.promise, delay(20_000).then(() => { throw new Error(`Server did not start: ${this.output}`) })])
  }
  async stop(): Promise<void> {
    const child = this.process
    if (!child || child.exitCode !== null) return
    const exited = Promise.withResolvers<void>()
    child.once('exit', () => exited.resolve())
    child.kill('SIGKILL')
    await exited.promise
    this.process = undefined
  }
  async dispose(): Promise<void> {
    await this.stop()
    this.fake.closeAllConnections()
    const closed = Promise.withResolvers<void>()
    this.fake.close(() => closed.resolve())
    await closed.promise
    await rm(this.dataDir, { recursive: true, force: true })
  }
  async api<T>(path: string, method = 'GET', body?: unknown): Promise<{ status: number; data: T }> {
    const response = await fetch(`${this.url}/api${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, data: await response.json() as T }
  }
  async log(id: string): Promise<GameEvent[]> { return (await this.api<GameEvent[]>(`/games/${id}/events`)).data }
  async until<T>(read: () => Promise<T>, predicate: (value: T) => boolean): Promise<T> {
    for (let attempt = 0; attempt < 400; attempt++) {
      const value = await read()
      if (predicate(value)) return value
      await delay(20)
    }
    throw new Error(`Condition did not settle; server output: ${this.output}`)
  }
}

export async function buildApp(): Promise<void> {
  const complete = Promise.withResolvers<void>()
  const child = spawn(process.execPath, ['node_modules/nuxt/bin/nuxt.mjs', 'build'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout?.on('data', chunk => { output += String(chunk) })
  child.stderr?.on('data', chunk => { output += String(chunk) })
  child.once('error', complete.reject)
  child.once('exit', code => { if (code === 0) complete.resolve(); else complete.reject(new Error(output)) })
  await complete.promise
}
