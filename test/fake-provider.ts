import { once } from 'node:events'
import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'

/** One scripted reply of the fake OpenAI-compatible provider, consumed in order per request. */
type FakeStep =
  /** A tool call; `arguments` is sent verbatim, so it may be malformed JSON. */
  | { kind: 'toolCall'; name: string; arguments: string; waitFor?: Promise<void> }
  /** Plain assistant text and no tool call. */
  | { kind: 'text'; content: string }
  | { kind: 'rateLimit'; retryAfterSec: number; retryAfter?: string }
  | { kind: 'serverError'; status: number }
  /** Never answers; the connection stays open until the caller gives up or the provider closes. */
  | { kind: 'hang' }
  | { kind: 'raw'; body: unknown }
  | { kind: 'disconnect' }
  | { kind: 'truncated' }

interface RecordedRequest {
  path: string
  headers: IncomingHttpHeaders
  body: Record<string, unknown>
  receivedAt: number
  closed: boolean
}

export interface FakeProvider {
  /** Base URL to store on a provider, e.g. `http://127.0.0.1:1234/v1`. */
  baseUrl: string
  script: (...steps: FakeStep[]) => void
  requests: RecordedRequest[]
  close: () => Promise<void>
}

const completion = (message: Record<string, unknown>) => ({
  id: 'chatcmpl-fake',
  object: 'chat.completion',
  created: 0,
  model: 'fake-model',
  choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
})

/** A local stand-in for an OpenAI-compatible Chat Completions endpoint that answers from a script. */
export async function startFakeProvider(): Promise<FakeProvider> {
  const steps: FakeStep[] = []
  const requests: RecordedRequest[] = []

  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      requests.push({
        path: req.url ?? '',
        headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
        receivedAt: Date.now(),
        closed: false,
      })
      const recorded = requests.at(-1)
      res.once('close', () => {
        if (recorded) recorded.closed = true
      })
      const step = steps.shift()
      const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers })
        res.end(JSON.stringify(body))
      }
      if (req.url !== '/v1/chat/completions') {
        json(404, { error: { message: `unexpected path ${req.url ?? ''}` } })
        return
      }
      if (!step) {
        json(500, { error: { message: 'fake provider: no scripted step left' } })
        return
      }
      switch (step.kind) {
        case 'toolCall': {
          const respond = () => {
            json(
              200,
              completion({
                content: null,
                tool_calls: [
                  {
                    id: 'call_fake',
                    type: 'function',
                    function: { name: step.name, arguments: step.arguments },
                  },
                ],
              }),
            )
          }
          if (step.waitFor) void step.waitFor.then(respond)
          else respond()
          return
        }
        case 'text':
          json(200, completion({ content: step.content }))
          return
        case 'rateLimit':
          json(
            429,
            { error: { message: 'rate limited' } },
            { 'retry-after': step.retryAfter ?? String(step.retryAfterSec) },
          )
          return
        case 'serverError':
          json(step.status, { error: { message: 'upstream error' } })
          return
        case 'hang':
          return
        case 'raw':
          json(200, step.body)
          return
        case 'disconnect':
          req.socket.destroy()
          return
        case 'truncated':
          res.writeHead(200, { 'content-type': 'application/json', 'content-length': '1000' })
          res.write('{"choices":[')
          res.destroy()
          return
      }
    })
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo

  return {
    baseUrl: `http://127.0.0.1:${String(port)}/v1`,
    script: (...next) => steps.push(...next),
    requests,
    close: async () => {
      server.closeAllConnections()
      server.close()
      await once(server, 'close')
    },
  }
}
