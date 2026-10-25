import { once } from 'node:events'
import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ApiFormat } from '../shared/types/models'

/** One scripted reply of the fake provider, consumed in order per request. */
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
  /** Base URL to store on a provider, following the format's official SDK, e.g. `http://127.0.0.1:1234/v1`. */
  baseUrl: string
  apiFormat: ApiFormat
  script: (...steps: FakeStep[]) => void
  requests: RecordedRequest[]
  close: () => Promise<void>
}

const PATHS: Record<ApiFormat, string> = {
  openai_completions: '/v1/chat/completions',
  openai_responses: '/v1/responses',
  anthropic_messages: '/v1/messages',
}

function jsonOrText(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function responseBody(
  format: ApiFormat,
  answer: { text: string } | { call: { name: string; arguments: string } },
) {
  switch (format) {
    case 'openai_completions':
      return {
        id: 'chatcmpl-fake',
        object: 'chat.completion',
        created: 0,
        model: 'fake-model',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              ...('text' in answer
                ? { content: answer.text }
                : {
                    content: null,
                    tool_calls: [{ id: 'call_fake', type: 'function', function: answer.call }],
                  }),
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }
    case 'openai_responses':
      return {
        id: 'resp-fake',
        object: 'response',
        model: 'fake-model',
        status: 'completed',
        output: [
          'text' in answer
            ? {
                type: 'message',
                id: 'msg_fake',
                role: 'assistant',
                content: [{ type: 'output_text', text: answer.text }],
              }
            : { type: 'function_call', id: 'fc_fake', call_id: 'call_fake', ...answer.call },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      }
    case 'anthropic_messages':
      return {
        id: 'msg-fake',
        type: 'message',
        role: 'assistant',
        model: 'fake-model',
        content: [
          'text' in answer
            ? { type: 'text', text: answer.text }
            : {
                type: 'tool_use',
                id: 'toolu_fake',
                name: answer.call.name,
                input: jsonOrText(answer.call.arguments),
              },
        ],
        stop_reason: 'text' in answer ? 'end_turn' : 'tool_use',
        usage: { input_tokens: 1, output_tokens: 1 },
      }
  }
}

/** A local stand-in for an LLM provider of the given API format that answers from a script. */
export async function startFakeProvider(
  responder?: (request: RecordedRequest) => FakeStep | undefined | Promise<FakeStep | undefined>,
  fallback?: (request: RecordedRequest) => FakeStep | undefined,
  apiFormat: ApiFormat = 'openai_completions',
): Promise<FakeProvider> {
  const steps: FakeStep[] = []
  const requests: RecordedRequest[] = []

  const server = createServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-methods', 'POST, OPTIONS')
    res.setHeader(
      'access-control-allow-headers',
      'authorization, content-type, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access',
    )
    res.setHeader('access-control-expose-headers', 'retry-after')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const request: RecordedRequest = {
        path: req.url ?? '',
        headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
        receivedAt: Date.now(),
        closed: false,
      }
      requests.push(request)
      res.once('close', () => {
        request.closed = true
      })
      const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers })
        res.end(JSON.stringify(body))
      }
      if (req.url !== PATHS[apiFormat]) {
        json(404, { error: { message: `unexpected path ${req.url ?? ''}` } })
        return
      }
      void Promise.resolve()
        .then(() => responder?.(request))
        .then((reply) => {
          const step = reply ?? steps.shift() ?? fallback?.(request)
          if (!step) {
            json(500, { error: { message: 'fake provider: no scripted step left' } })
            return
          }
          switch (step.kind) {
            case 'toolCall': {
              const respond = () => {
                json(
                  200,
                  responseBody(apiFormat, { call: { name: step.name, arguments: step.arguments } }),
                )
              }
              if (step.waitFor) void step.waitFor.then(respond)
              else respond()
              return
            }
            case 'text':
              json(200, responseBody(apiFormat, { text: step.content }))
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
        .catch((error: unknown) => {
          json(500, { error: { message: String(error) } })
        })
    })
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo

  return {
    baseUrl: `http://127.0.0.1:${String(port)}${apiFormat === 'anthropic_messages' ? '' : '/v1'}`,
    apiFormat,
    script: (...next) => steps.push(...next),
    requests,
    close: async () => {
      server.closeAllConnections()
      server.close()
      await once(server, 'close')
    },
  }
}
